// Read-only JSON-RPC proxy to Arkiv Rabdi. The access key stays on the server; the browser never sees it.
const RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";
const ALLOWED = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_estimateGas", "eth_getBalance", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_call", "eth_getLogs", "net_version",
  "arkiv_query", "arkiv_getEntity", "arkiv_getBlockTiming", "arkiv_getEntityNonce",
  "eth_sendRawTransaction", // already-signed txs from ephemeral signers; the proxy adds no authority
]);
const MAX_BODY = 256 * 1024;

type RpcReq = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export async function POST(request: Request) {
  const key = process.env.ARKIV_ACCESS_KEY;
  if (!key) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "server missing ARKIV_ACCESS_KEY" } }, { status: 500 });
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  let body: RpcReq | RpcReq[];
  try { body = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) return Response.json({ error: "1..20 calls per request" }, { status: 400 });
  for (const c of calls) {
    if (typeof c.method !== "string" || !ALLOWED.has(c.method))
      return Response.json({ jsonrpc: "2.0", id: c.id ?? null, error: { code: -32601, message: `method not allowed via proxy: ${String(c.method)}` } });
  }
  try {
    const upstream = await fetch(`${RPC}/${encodeURIComponent(key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: text, cache: "no-store", redirect: "error",
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  } catch {
    // never echo the upstream URL: it contains the access key
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Arkiv RPC unreachable" } }, { status: 502 });
  }
}
