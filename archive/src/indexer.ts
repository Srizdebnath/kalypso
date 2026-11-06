/**
 * "Old node runner": follows Rabdi, saves the RAW calldata of every Arkiv transaction to disk and
 * never deletes anything. This is exactly what any archive node / indexer can do. It proves that
 * deleteEntity does not erase data, and that after crypto-shredding the saved bytes are useless.
 *
 *   ARKIV_ACCESS_KEY=... ARCHIVE_PORT=7301 node dist/indexer.js
 *   GET /captures             -> list (newest first)
 *   GET /captures/<txHash>    -> raw calldata + decoded operations
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, ENTITY_EVENTS_ABI } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import {
  decodeAbiParameters, decodeEventLog, decodeFunctionData, hexToString, http as viemHttp, parseAbi, parseAbiParameters, toFunctionSelector,
  type Hex,
} from "viem";

const ARKIV_ADDRESS = "0x4400000000000000000000000000000000000044";
const EXECUTE_ABI = parseAbi(["function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)"]);
const EXECUTE_SELECTOR = toFunctionSelector(EXECUTE_ABI[0]);
const ATTRS = "(bytes32 name, uint8 typeId, bytes value)[]";
const CREATE = parseAbiParameters(`(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, ${ATTRS} attributes)`);
const DELETE = parseAbiParameters("(bytes32 entityKey)");
const EXTEND = parseAbiParameters("(bytes32 entityKey, uint64 expiresAt, uint64 minLifetime)");
const TYPE_NAMES: Record<number, string> = { 1: "bool", 2: "i32", 3: "u64", 4: "u256", 5: "dec", 7: "bytes", 8: "str", 9: "addr", 10: "key" };

const accessKey = process.env.ARKIV_ACCESS_KEY;
if (!accessKey) throw new Error("ARKIV_ACCESS_KEY required");
const DATA = path.resolve(process.env.ARCHIVE_DIR ?? "./archive-data");
const PORT = Number(process.env.ARCHIVE_PORT ?? 7301);
fs.mkdirSync(DATA, { recursive: true });

const client = createPublicClient({ chain: rabdi({ accessKey }), transport: viemHttp(undefined, { retryCount: 2, timeout: 20000 }) });

export type DecodedOp =
  | { op: "create"; entityKey?: string; expiresAt: string; attributes: { name: string; type: string; value: string }[] }
  | { op: "delete" | "extend" | "patch" | "transfer"; entityKey: string };

export type Capture = {
  txHash: string; blockNumber: string; from: string; capturedAt: number; bytes: number; input: Hex; ops: DecodedOp[];
};

function decodeOps(input: Hex, createdKeys: string[]): DecodedOp[] {
  const { args } = decodeFunctionData({ abi: EXECUTE_ABI, data: input });
  let ci = 0;
  return (args[0] as readonly { operation: number; operationData: Hex }[]).map((o) => {
    switch (o.operation) {
      case 1: {
        const [c] = decodeAbiParameters(CREATE, o.operationData);
        return {
          op: "create", entityKey: createdKeys[ci++], expiresAt: c.expiresAt.toString(),
          attributes: c.attributes.map((a) => {
            const name = hexToString(a.name, { size: 32 }).replace(/\0+$/, "");
            // high bit (0x80) is the INDEXED flag, not part of the type
            const type = TYPE_NAMES[a.typeId & 0x7f] ?? String(a.typeId);
            let value: string = a.value;
            if (type === "str") { try { value = hexToString(a.value); } catch { /* keep hex */ } }
            return { name, type, value };
          }),
        } as DecodedOp;
      }
      case 5: return { op: "delete", entityKey: decodeAbiParameters(DELETE, o.operationData)[0].entityKey };
      case 3: return { op: "extend", entityKey: decodeAbiParameters(EXTEND, o.operationData)[0].entityKey };
      case 2: return { op: "patch", entityKey: o.operationData.slice(0, 66) };
      default: return { op: "transfer", entityKey: o.operationData.slice(0, 66) };
    }
  });
}

const stateFile = path.join(DATA, "state.json");
let next: bigint;

async function captureBlock(n: bigint) {
  const block = await client.getBlock({ blockNumber: n, includeTransactions: true });
  for (const tx of block.transactions) {
    if (typeof tx === "string" || tx.to?.toLowerCase() !== ARKIV_ADDRESS) continue;
    if (!tx.input.startsWith(EXECUTE_SELECTOR)) continue; // not an entity write
    let ops: DecodedOp[] = [];
    try {
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      if (receipt.status !== "success") continue;
      const created: string[] = [];
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data, topics: log.topics }) as any;
          if (ev.eventName === "EntityCreated") created.push(ev.args.entityKey);
        } catch { /* other event */ }
      }
      ops = decodeOps(tx.input, created);
    } catch (e: any) {
      console.error("decode failed", tx.hash, e?.shortMessage ?? e?.message);
    }
    const cap: Capture = {
      txHash: tx.hash, blockNumber: n.toString(), from: tx.from, capturedAt: Date.now(),
      bytes: (tx.input.length - 2) / 2, input: tx.input, ops,
    };
    fs.writeFileSync(path.join(DATA, `${n.toString().padStart(12, "0")}-${tx.hash}.json`), JSON.stringify(cap));
    console.log(`captured ${tx.hash} block ${n} (${cap.bytes} bytes, ${ops.map((o) => o.op).join(",")})`);
  }
}

async function loop() {
  for (;;) {
    try {
      const head = await client.getBlockNumber();
      while (next <= head) {
        await captureBlock(next);
        next++;
        fs.writeFileSync(stateFile, JSON.stringify({ next: next.toString() }));
      }
    } catch (e: any) {
      console.error("poll error", e?.shortMessage ?? e?.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Older captures stored the raw typeId (with the 0x80 INDEXED bit); normalize on read. */
function normalize(c: Capture): Capture {
  return {
    ...c,
    ops: c.ops.map((o) => o.op !== "create" ? o : {
      ...o,
      attributes: o.attributes.map((a) => {
        const n = Number(a.type);
        if (!Number.isInteger(n)) return a;
        const type = TYPE_NAMES[n & 0x7f] ?? a.type;
        let value = a.value;
        if (type === "str" && /^0x[0-9a-f]*$/i.test(value)) { try { value = hexToString(value as Hex); } catch { /* keep */ } }
        return { ...a, type, value };
      }),
    }),
  } as Capture;
}
const appOf = new Map<string, string>(); // file -> "app" attribute (memo, files are immutable)
function readCapture(f: string): Capture { return normalize(JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"))); }
function captureApp(f: string) {
  let a = appOf.get(f);
  if (a === undefined) {
    const c = readCapture(f);
    a = c.ops.flatMap((o) => (o.op === "create" ? o.attributes : [])).find((x) => x.name === "app")?.value ?? "";
    appOf.set(f, a);
  }
  return a;
}

function listCaptures() {
  return fs.readdirSync(DATA).filter((f) => f.endsWith(".json") && f !== "state.json").sort().reverse();
}

http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const [url, qs] = (req.url ?? "").split("?");
  if (url === "/captures") {
    const app = new URLSearchParams(qs ?? "").get("app");
    const files = app ? listCaptures().filter((f) => captureApp(f) === app) : listCaptures();
    const items = files.slice(0, 200).map((f) => {
      const c = readCapture(f);
      const { input, ...rest } = c;
      return { ...rest, ops: c.ops.map((o) => (o.op === "create" ? { ...o, attributes: o.attributes.map((a) => ({ ...a, value: a.value.length > 80 ? a.value.slice(0, 80) + "…" : a.value })) } : o)) };
    });
    return void res.end(JSON.stringify({ following: next.toString(), items }));
  }
  const m = url.match(/^\/captures\/(0x[0-9a-fA-F]{64})$/);
  if (m) {
    const f = listCaptures().find((x) => x.endsWith(`-${m[1].toLowerCase()}.json`) || x.endsWith(`-${m[1]}.json`));
    if (!f) return void res.writeHead(404).end(JSON.stringify({ error: "not captured" }));
    return void res.end(JSON.stringify(readCapture(f)));
  }
  res.writeHead(404).end(JSON.stringify({ error: "not found" }));
}).listen(PORT, async () => {
  const saved = fs.existsSync(stateFile) ? BigInt(JSON.parse(fs.readFileSync(stateFile, "utf8")).next) : undefined;
  const from = process.env.ARCHIVE_FROM_BLOCK ? BigInt(process.env.ARCHIVE_FROM_BLOCK) : undefined;
  next = from ?? saved ?? (await client.getBlockNumber()) - 30n;
  console.log(`[archive] following Rabdi from block ${next}, http :${PORT}, data ${DATA}`);
  loop();
});
