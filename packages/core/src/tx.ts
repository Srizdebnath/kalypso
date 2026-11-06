import type { ExecuteBatchParameters, ExecuteBatchReturnType } from "@arkiv-network/sdk";
import { createWalletClient } from "@arkiv-network/sdk";
import { custom, type Address, type Chain, type EIP1193Provider, type PublicClient } from "viem";

/**
 * Guarded Arkiv writes, following Arkiv's write-safety recipe for Rabdi:
 *  1. exact unsigned gas estimate (signing/sending blocked during estimation)
 *  2. gas = max(1_000_000 + 400_000 * (ops - 1), 2 * estimate) and <= latestBlock.gasLimit / 2
 *  3. latest nonce == pending nonce (no in-flight tx from this account), current gasPrice
 *  4. balance covers gas * gasPrice
 *  5. explicit {gas, gasPrice, nonce} handed to the wallet, receipt.status must be success
 * No automatic resend, ever. An uncertain outcome is surfaced to the caller to reconcile.
 */

export class ArkivWriteError extends Error {
  constructor(
    message: string,
    readonly txHash?: string,
  ) {
    super(message);
    this.name = "ArkivWriteError";
  }
}

const RO_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_estimateGas",
]);

export type RpcRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

export type WriteEnv = {
  chain: Chain;
  /** Read RPC (e.g. the app's /api/rpc proxy). Used for estimation and checks. */
  rpc: RpcRequest;
  publicClient: PublicClient;
  /** EIP-1193 provider that signs (browser wallet) or a viem LocalAccount-backed transport. */
  provider: EIP1193Provider;
  account: Address;
  /** Max fee in wei the user approved for one write (default 0.05 tGLM). */
  maxFeeWei?: bigint;
  /** Called with the exact gas cap cost before the balance check (e.g. a relayer tops up an ephemeral signer). */
  ensureFunds?: (account: Address, costWei: bigint) => Promise<void>;
};

export const RABDI_CHAIN_ID = 7794095;

export function opCount(batch: ExecuteBatchParameters): number {
  return (
    (batch.creates?.length ?? 0) +
    (batch.patches?.length ?? 0) +
    (batch.deletes?.length ?? 0) +
    (batch.extensions?.length ?? 0) +
    (batch.ownershipChanges?.length ?? 0)
  );
}

async function estimateBatch(env: WriteEnv, batch: ExecuteBatchParameters): Promise<bigint> {
  let estimate: bigint | undefined;
  const STOP = new Error("arkivzk: estimate captured");
  const transport = custom(
    {
      async request(args: { method: string; params?: any }) {
        if (!RO_METHODS.has(args.method)) throw new Error("arkivzk: mutating RPC blocked during estimate");
        if (args.method === "eth_estimateGas") {
          const res = await env.rpc({ method: "eth_estimateGas", params: [args.params?.[0], "latest"] });
          if (typeof res !== "string" || !/^0x[0-9a-f]+$/i.test(res)) throw new Error("invalid estimate");
          estimate = BigInt(res);
          throw STOP;
        }
        return env.rpc(args);
      },
    },
    { retryCount: 0 },
  );
  const wallet = createWalletClient({ chain: env.chain, account: env.account, transport });
  try {
    await wallet.executeBatch(batch);
  } catch (e) {
    let c: any = e;
    for (let i = 0; c && i < 24; i++, c = c.cause) if (c === STOP && estimate) return estimate;
    throw new ArkivWriteError("Gas estimation failed (the write would revert or the RPC rejected it)");
  }
  throw new ArkivWriteError("Estimation path did not reach eth_estimateGas");
}

export async function guardedBatch(env: WriteEnv, batch: ExecuteBatchParameters): Promise<ExecuteBatchReturnType> {
  const ops = opCount(batch);
  if (ops === 0) throw new ArkivWriteError("empty batch");

  const chainId = BigInt((await env.rpc({ method: "eth_chainId" })) as string);
  if (chainId !== BigInt(RABDI_CHAIN_ID)) throw new ArkivWriteError("RPC is not Rabdi");
  const walletChain = BigInt((await env.provider.request({ method: "eth_chainId" })) as string);
  if (walletChain !== BigInt(RABDI_CHAIN_ID)) throw new ArkivWriteError("Wallet is not on Rabdi (chain 7794095)");

  const estimate = await estimateBatch(env, batch);
  const floor = 1_000_000n + 400_000n * BigInt(ops - 1);
  const gas = floor > 2n * estimate ? floor : 2n * estimate;

  const block = await env.publicClient.getBlock({ blockTag: "latest" });
  if (gas > block.gasLimit / 2n) throw new ArkivWriteError("Batch too large for one transaction; split it");

  const [latest, pending] = await Promise.all([
    env.publicClient.getTransactionCount({ address: env.account, blockTag: "latest" }),
    env.publicClient.getTransactionCount({ address: env.account, blockTag: "pending" }),
  ]);
  if (latest !== pending) throw new ArkivWriteError("A previous transaction from this wallet is still pending");

  const gasPrice = await env.publicClient.getGasPrice();
  const cost = gas * gasPrice;
  const maxFee = env.maxFeeWei ?? 50_000_000_000_000_000n;
  if (cost > maxFee) throw new ArkivWriteError(`Gas cap ${cost} wei exceeds approved max fee ${maxFee} wei`);
  if (env.ensureFunds) await env.ensureFunds(env.account, cost);
  const balance = await env.publicClient.getBalance({ address: env.account });
  if (cost > balance) throw new ArkivWriteError("Insufficient tGLM balance - use the Arkiv faucet");

  const wallet = createWalletClient({ chain: env.chain, account: env.account, transport: custom(env.provider) });
  try {
    return await wallet.executeBatch(batch, { gas, gasPrice, nonce: latest });
  } catch (e: any) {
    const tx = e?.txHash ?? e?.cause?.txHash;
    if (e?.name === "UserRejectedRequestError" || e?.cause?.code === 4001 || e?.code === 4001)
      throw new ArkivWriteError("Transaction rejected in wallet");
    throw new ArkivWriteError(
      tx
        ? "Transaction was submitted but did not succeed - check it in the explorer before retrying"
        : "Transaction failed before submission",
      tx,
    );
  }
}
