// Gas relayer for ephemeral per-record signers. All ephemeral signers are funded by this ONE pool
// address, so on-chain the records link to the pool (shared by every user), not to the user's wallet.
// Abuse limits: key-possession signature, fresh timestamp, per-IP rate limit, per-request cap.
import { createPublicClient, createWalletClient, http, verifyMessage, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";
const MAX_TOPUP_WEI = 50_000_000_000_000_000n; // 0.05 tGLM per request
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

const chain = {
  id: 7794095, name: "Arkiv Rabdi", nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const message = (address: string, minBalanceWei: bigint, ts: number) =>
  `arkivzk-relayer|v1|${address.toLowerCase()}|${minBalanceWei}|${ts}`;

export async function POST(request: Request) {
  const key = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  const accessKey = process.env.ARKIV_ACCESS_KEY;
  if (!key || !accessKey) return Response.json({ error: "relayer not configured (RELAYER_PRIVATE_KEY)" }, { status: 503 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return Response.json({ error: "rate limited" }, { status: 429 });
  hits.set(ip, [...recent, now]);

  let body: { address?: string; minBalanceWei?: string; ts?: number; signature?: Hex };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const { address, ts, signature } = body;
  if (!address || !isAddress(address) || !signature || typeof ts !== "number" || !/^\d{1,30}$/.test(body.minBalanceWei ?? ""))
    return Response.json({ error: "bad request" }, { status: 400 });
  if (Math.abs(now - ts) > 2 * 60 * 1000) return Response.json({ error: "stale request" }, { status: 400 });
  const minBalance = BigInt(body.minBalanceWei!);
  if (minBalance > MAX_TOPUP_WEI) return Response.json({ error: "requested balance above relayer cap" }, { status: 400 });
  const ok = await verifyMessage({ address, message: message(address, minBalance, ts), signature }).catch(() => false);
  if (!ok) return Response.json({ error: "signature does not match address" }, { status: 401 });

  const transport = http(`${RPC}/${encodeURIComponent(accessKey)}`, { retryCount: 1, timeout: 20000 });
  const pc = createPublicClient({ chain, transport });
  const pool = createWalletClient({ chain, transport, account: privateKeyToAccount(key) });
  try {
    const bal = await pc.getBalance({ address });
    if (bal >= minBalance) return Response.json({ funded: "0", balance: bal.toString() });
    const amount = ((minBalance - bal) * 12n) / 10n; // +20% for fee drift
    const hash = await pool.sendTransaction({ to: address, value: amount > MAX_TOPUP_WEI ? MAX_TOPUP_WEI : amount });
    const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") return Response.json({ error: "funding tx reverted" }, { status: 502 });
    return Response.json({ funded: amount.toString(), txHash: hash });
  } catch {
    // never echo upstream errors: the RPC URL contains the access key
    return Response.json({ error: "relayer could not fund (pool empty or RPC unavailable)" }, { status: 502 });
  }
}
