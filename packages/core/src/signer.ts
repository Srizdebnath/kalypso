import { privateKeyToAccount } from "viem/accounts";
import type { Chain, EIP1193Provider, Hex } from "viem";
import type { RpcRequest } from "./tx.js";

/**
 * EIP-1193 provider backed by a local private key (ephemeral per-record signer).
 * Signs eth_sendTransaction locally and broadcasts the signed bytes; everything else goes to `rpc`.
 */
export function localKeyProvider(privateKey: Hex, chain: Chain, rpc: RpcRequest): EIP1193Provider {
  const account = privateKeyToAccount(privateKey);
  const request = async ({ method, params }: { method: string; params?: any }) => {
    switch (method) {
      case "eth_chainId": return "0x" + chain.id.toString(16);
      case "eth_accounts":
      case "eth_requestAccounts": return [account.address];
      case "eth_sendTransaction": {
        const tx = params[0];
        const signed = await account.signTransaction({
          chainId: chain.id, type: "legacy", to: tx.to, data: tx.data,
          gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice), nonce: Number(BigInt(tx.nonce)), value: tx.value ? BigInt(tx.value) : 0n,
        });
        return rpc({ method: "eth_sendRawTransaction", params: [signed] });
      }
      default: return rpc({ method, params });
    }
  };
  return { request, on: () => {}, removeListener: () => {} } as unknown as EIP1193Provider;
}

export function addressOf(privateKey: Hex) {
  return privateKeyToAccount(privateKey).address;
}
