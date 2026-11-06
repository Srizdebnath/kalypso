// Live benchmark of queries over ENCRYPTED data on Arkiv Rabdi: before (download + decrypt everything) vs after (blind tags evaluated by Arkiv).
//   node packages/sdk/query-encrypted.mjs
// Writes docs/query-bench.json (used in docs/07 §5).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createWalletClient as viemWallet, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ArkivZK, Vault, MemoryKV, rawKeySealer, GuardianClient, ZkRecord } from "./dist/index.js";
import { eq, and, gt, asc } from "@arkiv-network/sdk/query";
import { key } from "@arkiv-network/sdk";
import { aead } from "@arkivzk/crypto";
import { shutdown } from "@arkivzk/zk";

const root = path.resolve(import.meta.dirname, "../..");
const env = Object.fromEntries(
  [".env", "apps/web/.env.local"].flatMap((f) => fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8").split("\n") : [])
    .filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const chain = rabdi({ accessKey: env.ARKIV_ACCESS_KEY });
const transport = http(undefined, { retryCount: 1, timeout: 20000 });
const publicClient = createPublicClient({ chain, transport, cacheTime: 0 });
const account = privateKeyToAccount(env.DEV_PRIVATE_KEY);
const signer = viemWallet({ chain, transport, account });
const rpc = (args) => publicClient.request(args);

// EIP-1193 provider backed by a local key: signs eth_sendTransaction locally, forwards the rest.
const provider = {
  async request({ method, params }) {
    if (method === "eth_sendTransaction") {
      const tx = params[0];
      return signer.sendTransaction({
        to: tx.to, data: tx.data, gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice),
        nonce: tx.nonce !== undefined ? Number(BigInt(tx.nonce)) : undefined, value: tx.value ? BigInt(tx.value) : 0n,
      });
    }
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [account.address];
    return rpc({ method, params });
  },
};

const t = {};
const gas = {};
async function gasOf(name, txHash) { const r = await publicClient.getTransactionReceipt({ hash: txHash }); gas[name] = r.gasUsed.toString(); console.log(`  gasUsed ${name}: ${r.gasUsed}`); }
async function timed(name, fn) {
  const s = performance.now();
  try { return await fn(); } finally { t[name] = Math.round(performance.now() - s); console.log(`  ${name}: ${t[name]} ms`); }
}

// --- guardians (real processes) ---
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arkivzk-qb-"));
const procs = [];
for (const [name, port] of [["qb-guardian-1", 17211], ["qb-guardian-2", 17212]]) {
  procs.push(spawn(process.execPath, [path.join(root, "guardian/dist/server.js")], {
    env: { ...process.env, GUARDIAN_NAME: name, PORT: String(port), GUARDIAN_DATA_DIR: path.join(dataDir, name) }, stdio: "inherit",
  }));
}
await new Promise((r) => setTimeout(r, 800));
const cleanup = () => { procs.forEach((p) => p.kill()); fs.rmSync(dataDir, { recursive: true, force: true }); };

const ms = async (f) => { const s = performance.now(); const r = await f(); return [r, Math.round(performance.now() - s)]; };
const out = { at: new Date().toISOString(), signer: account.address };
try {
  const vault = await Vault.open(new MemoryKV(), rawKeySealer(aead.newKey()));
  const zk = new ArkivZK({
    publicClient, vault,
    guardians: [new GuardianClient("http://127.0.0.1:17211"), new GuardianClient("http://127.0.0.1:17212")],
    write: { chain, rpc, publicClient, provider, account: account.address },
  });
  const S = "bench.v1";
  const people = [
    { age: 12, country: "IN" }, { age: 17, country: "DE" }, { age: 18, country: "IN" },
    { age: 30, country: "IN" }, { age: 45, country: "US" }, { age: 90, country: "IN" },
  ];
  console.log(`writing ${people.length} encrypted records (range index on age, blind index on country)…`);
  const keys = [];
  for (const p of people) {
    const r = await zk.put({ schemaId: S, values: p, retentionSeconds: 1800, searchable: ["country"], rangeField: "age" });
    keys.push(r.entityKey); console.log("  put", p, r.entityKey.slice(0, 12));
  }
  const parent = keys[0];
  const child = await zk.put({ schemaId: S, values: { age: 40, country: "IN" }, retentionSeconds: 1800, parent, rangeField: "age" });
  console.log("  child of", parent.slice(0, 12), "->", child.entityKey.slice(0, 12));
  const all = [...keys, child.entityKey];
  const N = all.length;

  // ---------- BEFORE: what Arkiv alone allows on encrypted data: download every ciphertext, decrypt locally, filter
  const [before, tBefore] = await ms(async () => {
    let queries = 0, bytes = 0, cursor;
    const rows = [];
    for (;;) {
      const page = await publicClient.select({ $key: true, ct: true, envId: true }).from(ZkRecord)
        .where(and(eq("app", "arkivzk"), eq("schemaId", S), ...(cursor ? [gt("$key", key(cursor))] : []))).orderBy(asc("$key")).limit(100).fetch();
      queries++; rows.push(...page.entities);
      bytes += page.entities.reduce((n, e) => n + (e.ct.value.length - 2) / 2 + (e.envId.value.length - 2) / 2, 0);
      if (page.entities.length < 100) break; cursor = page.entities[page.entities.length - 1].$key;
    }
    let guardianRtts = 0; const hits = [];
    for (const e of rows) { const r = await zk.get(e.$key); guardianRtts += 2; if (r.record.values.age >= 18 && r.record.values.age <= 40) hits.push(e.$key.toLowerCase()); }
    return { hits, queries, bytes, decrypts: rows.length, guardianRtts, scanned: rows.length };
  });
  console.log(`BEFORE  age in [18,40]: ${before.hits.length} hits, scanned ${before.scanned}, ${before.queries} queries, ${before.bytes} B ciphertext, ${before.decrypts} decrypts, ${tBefore} ms`);

  // ---------- AFTER: range index, Arkiv evaluates it
  const [range, tRange] = await ms(() => zk.searchRange(S, "age", 18, 40, [epochOfNow()]));
  console.log(`AFTER   age in [18,40]: ${range.keys.length} hits, ${range.queries} query, ${range.terms} OR terms (${range.nodes} tree nodes), ${tRange} ms`);
  const sameRange = JSON.stringify([...before.hits].sort()) === JSON.stringify([...range.keys].sort());

  const [cnt, tCnt] = await ms(() => zk.count(S, "age", { min: 18, max: 40 }, [epochOfNow()]));
  console.log(`COUNT   age in [18,40]: ${cnt.count} in ${cnt.queries} count query, ${tCnt} ms (0 rows downloaded)`);
  const [cntEq, tCntEq] = await ms(() => zk.count(S, "country", { eq: "IN" }, [epochOfNow()]));
  console.log(`COUNT   country = IN: ${cntEq.count}, ${tCntEq} ms`);
  const [eqS, tEq] = await ms(() => zk.search(S, "country", "IN", [epochOfNow()]));
  console.log(`SEARCH  country = IN: ${eqS.keys.length} hits, ${eqS.queries} query, ${tEq} ms`);

  // ---------- relations: JOIN parent -> child, then cascade shred
  const [kids, tKids] = await ms(() => zk.childrenOf(parent));
  console.log(`JOIN    childrenOf(parent): ${kids.keys.length} child, ${kids.queries} query, ${tKids} ms`);
  const [sh, tSh] = await ms(() => zk.shred([parent], () => {}, { cascade: true }));
  console.log(`CASCADE shred(parent, cascade): deleted ${sh.deleted.length} entities, keys destroyed ${sh.keysDestroyed}, ${sh.txHashes.length} tx, ${tSh} ms`);
  const kidsAfter = await zk.childrenOf(parent).catch(() => ({ keys: [] }));
  const childLive = (await publicClient.select({ $key: true }).from(ZkRecord).where(eq("$key", key(child.entityKey))).fetch()).entities.length;

  // cleanup: shred the rest of the test records in one tx
  const rest = keys.slice(1);
  const cl = await zk.shred(rest);
  console.log(`cleanup: shredded ${cl.deleted.length} test records in ${cl.txHashes.length} tx`);

  Object.assign(out, {
    records: N,
    before: { ...before, ms: tBefore, hits: before.hits.length },
    afterRange: { hits: range.keys.length, queries: range.queries, terms: range.terms, nodes: range.nodes, ms: tRange, sameResultAsBefore: sameRange },
    countRange: { count: cnt.count, queries: cnt.queries, ms: tCnt },
    countEq: { count: cntEq.count, ms: tCntEq },
    searchEq: { hits: eqS.keys.length, queries: eqS.queries, ms: tEq },
    join: { children: kids.keys.length, queries: kids.queries, ms: tKids },
    cascade: { deleted: sh.deleted.length, keysDestroyed: sh.keysDestroyed, txs: sh.txHashes.length, ms: tSh, childLiveAfter: childLive, childrenAfter: kidsAfter.keys.length },
  });
  if (!sameRange) throw new Error("range search result differs from decrypt-everything result");
  if (cnt.count !== range.keys.length) throw new Error("count != range hits");
  if (kids.keys.length !== 1 || childLive !== 0) throw new Error("join/cascade failed");
  fs.writeFileSync(path.join(root, "docs/query-bench.json"), JSON.stringify(out, null, 2));
  console.log("\nALL QUERY CHECKS PASSED");
} catch (e) {
  console.error("FAILED:", e?.shortMessage ?? e?.message ?? e);
  process.exitCode = 1;
} finally {
  cleanup(); await shutdown();
}
function epochOfNow() { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
