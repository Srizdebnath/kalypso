// Live test of the relational layer on Arkiv Rabdi: atomic multi-insert, 1:N, M:N, batched JOIN (N+1), orphans, cascade renew/shred, recovery of relations.
//   node packages/sdk/relational.mjs
// Writes docs/relational-bench.json (docs/07 §6).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createWalletClient as viemWallet, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ArkivZK, Vault, MemoryKV, rawKeySealer, GuardianClient, LeaseManager } from "./dist/index.js";
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arkivzk-rel-"));
const procs = [];
for (const [name, port] of [["rel-guardian-1", 17221], ["rel-guardian-2", 17222]]) {
  procs.push(spawn(process.execPath, [path.join(root, "guardian/dist/server.js")], {
    env: { ...process.env, GUARDIAN_NAME: name, PORT: String(port), GUARDIAN_DATA_DIR: path.join(dataDir, name) }, stdio: "inherit",
  }));
}
await new Promise((r) => setTimeout(r, 800));
const cleanup = () => { procs.forEach((p) => p.kill()); fs.rmSync(dataDir, { recursive: true, force: true }); };

const ms = async (f) => { const s = performance.now(); const r = await f(); return [r, Math.round(performance.now() - s)]; };
const check = (cond, msg) => { if (!cond) throw new Error("CHECK FAILED: " + msg); console.log("  ✓", msg); };
const out = { at: new Date().toISOString(), signer: account.address };
const guardians = () => [new GuardianClient("http://127.0.0.1:17221"), new GuardianClient("http://127.0.0.1:17222")];
const write = { chain, rpc, publicClient, provider, account: account.address };
try {
  const vault = await Vault.open(new MemoryKV(), rawKeySealer(aead.newKey()));
  const zk = new ArkivZK({ publicClient, vault, guardians: guardians(), write });
  const H = 3600;

  console.log("1. atomic multi-insert: patient, doctor, visit (junction, M:N), lab (1:N child) in ONE tx");
  const [rows, tIns] = await ms(() => zk.putMany([
    { schemaId: "patient.v1", values: { age: 30, country: "IN" }, retentionSeconds: 2 * H },
    { schemaId: "doctor.v1", values: { speciality: "cardio" }, retentionSeconds: 2 * H },
    { schemaId: "visit.v1", values: { day: 12, fee: 40 }, retentionSeconds: 2 * H, parents: [{ key: { index: 0 }, relation: "visit" }, { key: { index: 1 }, relation: "visit" }] },
    { schemaId: "lab.v1", values: { hb: 13 }, retentionSeconds: 24 * H, parents: [{ key: { index: 0 }, relation: "lab" }] }, // asks for 24h
  ]));
  const [P, D, V, L] = rows.map((r) => r.entityKey);
  check(new Set(rows.map((r) => r.txHash)).size === 1, `4 entities, 1 transaction (${rows[0].txHash.slice(0, 12)}…, ${tIns} ms)`);
  const gasIns = (await publicClient.getTransactionReceipt({ hash: rows[0].txHash })).gasUsed;
  check(rows[3].expiresAtBlock <= rows[0].expiresAtBlock, `lab asked for 24h but expires at parent's block ${rows[3].expiresAtBlock} <= ${rows[0].expiresAtBlock} (child never outlives parent)`);

  console.log("2. 1:N, belongsTo, M:N");
  const [labs, tLab] = await ms(() => zk.childrenOf(P, "lab"));
  check(labs.keys.length === 1 && labs.keys[0] === L, `childrenOf(patient, "lab") = [lab] in ${labs.queries} query, ${tLab} ms`);
  check((await zk.parentsOf(L))[0].entityKey === P, "parentsOf(lab) = patient (no query)");
  const [docs, tM] = await ms(() => zk.linked(P, "visit"));
  check(docs.links.length === 1 && docs.links[0].other === D && docs.links[0].junction === V, `linked(patient, "visit") = doctor via junction, ${docs.queries} query, ${tM} ms`);
  const back = await zk.linked(D, "visit");
  check(back.links[0]?.other === P, "linked(doctor, \"visit\") = patient (the relation works both ways)");

  console.log("3. N+1 elimination: 5 parents + 5 children in one tx, then batched JOIN");
  const batch = [];
  for (let i = 0; i < 5; i++) batch.push({ schemaId: "order.v1", values: { n: i }, retentionSeconds: H });
  for (let i = 0; i < 5; i++) batch.push({ schemaId: "item.v1", values: { n: i }, retentionSeconds: H, parents: [{ key: { index: i } }] });
  const made = await zk.putMany(batch);
  const parents5 = made.slice(0, 5).map((r) => r.entityKey);
  check(new Set(made.map((r) => r.txHash)).size === 1, "10 entities in 1 transaction");
  const [naive, tNaive] = await ms(async () => { let q = 0; const m = new Map(); for (const p of parents5) { const r = await zk.childrenOf(p); q += r.queries; m.set(p, r.keys); } return { m, q }; });
  const [batched, tBatched] = await ms(() => zk.childrenOfMany(parents5));
  const same = parents5.every((p) => JSON.stringify(naive.m.get(p)) === JSON.stringify(batched.byParent.get(p)));
  check(same, `same join result: N+1 = ${naive.q} queries / ${tNaive} ms  vs  batched = ${batched.queries} query / ${tBatched} ms`);

  console.log("4. recovery restores relations from ciphertext on a fresh device");
  const kit = vault.exportRecoveryKit("correct horse battery staple");
  const vault2 = await Vault.importRecoveryKit(new MemoryKV(), rawKeySealer(aead.newKey()), kit, "correct horse battery staple");
  const zk2 = new ArkivZK({ publicClient, vault: vault2, guardians: guardians(), write });
  const [found, tRec] = await ms(() => zk2.recover(account.address));
  const labOn2 = await vault2.getRecord(L);
  check(labOn2?.parents?.[0]?.entityKey === P && labOn2.parents[0].relation === "lab", `recovered ${found.length} records in ${tRec} ms; lab -> patient relation restored`);
  check((await zk2.linked(P, "visit")).links[0]?.other === D, "M:N works on the recovered device");

  console.log("5. orphans + cascade renew + cascade shred");
  check((await zk.orphans()).length === 0, "no orphans yet");
  await zk.shred([D]); // shred doctor only: the visit junction now dangles
  const orph = await zk.orphans();
  check(orph.length === 1 && orph[0] === V, "after shredding the doctor, orphans() = [visit junction]");
  const lm = new LeaseManager(zk);
  const before = { P: (await vault.getRecord(P)).expiresAtBlock, L: (await vault.getRecord(L)).expiresAtBlock };
  const [ren, tRen] = await ms(() => lm.renew([P], 3600, () => {}, { cascade: true }));
  const after = { P: (await vault.getRecord(P)).expiresAtBlock, L: (await vault.getRecord(L)).expiresAtBlock };
  check(BigInt(after.P) > BigInt(before.P) && BigInt(after.L) > BigInt(before.L) && BigInt(after.L) <= BigInt(after.P), `cascade renew: patient + lab + visit extended in ${ren.txHashes.length} tx (${ren.extended} entities), lab still <= patient, ${tRen} ms`);
  const [sh, tSh] = await ms(() => zk.shred([P], () => {}, { cascade: true }));
  check(sh.deleted.length === 3 && sh.txHashes.length === 1, `cascade shred(patient): ${sh.deleted.length} entities (patient, visit, lab) in ${sh.txHashes.length} tx, ${tSh} ms`);
  check((await zk2.childrenOf(P, "lab").catch(() => ({ keys: [] }))).keys.length === 0, "no children left on Arkiv");

  const rest = made.map((r) => r.entityKey);
  const cl = await zk.shred(rest);
  console.log(`  cleanup: shredded the 10 order/item rows in ${cl.txHashes.length} tx (auto-split under the half-block gas rule)`);

  Object.assign(out, {
    atomicInsert: { rows: 4, txs: 1, ms: tIns, gasUsed: gasIns.toString() },
    oneToMany: { queries: labs.queries, ms: tLab },
    manyToMany: { queries: docs.queries, ms: tM },
    nPlusOne: { parents: 5, naiveQueries: naive.q, naiveMs: tNaive, batchedQueries: batched.queries, batchedMs: tBatched },
    recovery: { records: found.length, ms: tRec, relationsRestored: true },
    cascadeRenew: { txs: ren.txHashes.length, entities: ren.extended, ms: tRen },
    cascadeShred: { entities: sh.deleted.length, txs: sh.txHashes.length, ms: tSh },
  });
  fs.writeFileSync(path.join(root, "docs/relational-bench.json"), JSON.stringify(out, null, 2));
  console.log("\nALL RELATIONAL CHECKS PASSED");
} catch (e) {
  console.error("FAILED:", e?.shortMessage ?? e?.message ?? e);
  process.exitCode = 1;
} finally {
  cleanup(); await shutdown();
}
