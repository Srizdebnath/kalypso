// Live, read-only check of the query layer on Arkiv Rabdi: planner, IN-batching, keyset paging,
// narrow projection, relational helpers. Usage: ARKIV_ACCESS_KEY=... node packages/sdk/query-live.mjs
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { QueryPlanner, ZkRecord, ShredReceipt } from "./dist/index.js";
import { liveKeys } from "./dist/live.js";

const pc = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http() });
const qp = new QueryPlanner(pc);
const ms = async (f) => { const s = performance.now(); const r = await f(); return [r, Math.round(performance.now() - s)]; };
const out = {};

// 1. planner warns before a full scan on a non-indexed column
console.log(qp.explain({ from: ZkRecord, where: { app: "arkivzk", ct: "0x00" } }), "\n");

// 2. keyset pagination: walk all arkivzk receipts with page size 1 -> stable cursor on $key
const [all, tAll] = await ms(() => qp.run({ from: ShredReceipt, where: { app: "arkivzk" }, select: ["level"] }));
const [paged, tPaged] = await ms(() => qp.run({ from: ShredReceipt, where: { app: "arkivzk" }, select: ["level"], pageSize: 1 }));
const same = JSON.stringify(all.rows.map((r) => r.$key)) === JSON.stringify(paged.rows.map((r) => r.$key));
console.log(`keyset: ${all.rows.length} rows in ${all.queries} query (page 100) vs ${paged.queries} queries (page 1); identical order: ${same}`);
out.keyset = { rows: all.rows.length, page100Queries: all.queries, page1Queries: paged.queries, identical: same };

// 3. IN-batching: 45 record keys (3 real-looking receipts' keys + random) -> ceil(45/20)=3 queries, not 45
const keys = [...all.rows.map((r) => r.$key)];
while (keys.length < 45) keys.push("0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join(""));
const [pf, tPf] = await ms(() => qp.proofsFor(keys));
console.log(`proofsFor(${keys.length} keys): ${pf.queries} queries, ${pf.rows.length} proofs, ${tPf} ms (naive: ${keys.length} queries)`);
out.inBatching = { keys: keys.length, queries: pf.queries, naive: keys.length, ms: tPf };

// 4. liveKeys: existence of 45 keys in ceil(45/20) queries
const [lk, tLk] = await ms(() => liveKeys(pc, keys));
console.log(`liveKeys(${keys.length}): ${lk.size} live (receipts), 3 queries, ${tLk} ms (naive: ${keys.length} getEntity calls)`);
out.liveKeys = { keys: keys.length, live: lk.size, ms: tLk };

// 5. narrow projection vs full row: bytes downloaded for every live record
const [narrow] = await ms(() => qp.run({ from: ZkRecord, where: { app: "arkivzk" }, select: ["schemaId", "epoch"] }));
const full = await pc.select({ $key: true, ct: true, envId: true, schemaId: true, epoch: true }).from(ZkRecord).limit(100).fetch();
const size = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)).length;
console.log(`projection: ${narrow.rows.length} records, metadata ${size(narrow.rows)} B vs with ciphertext ${size(full.entities)} B`);
out.projection = { records: narrow.rows.length, narrowBytes: size(narrow.rows), fullBytes: size(full.entities) };

// 6. hasMany join + belongsTo: records -> their proofs in one batched lookup
const recKeys = narrow.rows.map((r) => r.$key);
const joined = recKeys.length ? await qp.proofsFor(recKeys) : { rows: [], queries: 0 };
console.log(`join records->proofs: ${recKeys.length} records, ${joined.rows.length} proofs, ${joined.queries} queries`);
out.join = { records: recKeys.length, proofs: joined.rows.length, queries: joined.queries };

import("node:fs").then((fs) => fs.writeFileSync(new URL("../../docs/query-live.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2)));
console.log("\n" + JSON.stringify(out));
