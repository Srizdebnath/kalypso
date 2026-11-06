# 06 · SDK reference

Every public feature of `@arkivzk/sdk`, with the code you write and what happens underneath.
Complexity and measured costs for each call are in [07 · Performance](07-performance.md).

```
@arkivzk/sdk      ArkivZK (put/get/prove/shred/recover), verifyProofEntity, getReceipt, LeaseManager, QueryPlanner
@arkivzk/core     Arkiv schemas, guarded writes (gas policy), record format, guardian protocol types
@arkivzk/crypto   AES-256-GCM, padding, Shamir, ML-KEM-768+X25519 HPKE, Ed25519, field encoding
@arkivzk/zk       Noir circuits (commit, range) + UltraHonk prove/verify
@arkivzk/vault    encrypted local vault, guardian client, recovery kit
@arkivzk/swarm    encrypted attachments on Swarm
guardian/         key-share custodian service (RAM-only by default)
archive/          "old node runner": captures raw Arkiv calldata forever
```

---

## 1. Setup

```ts
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { custom } from "viem";
import { ArkivZK, Vault, IndexedDBKV, webCryptoSealer, GuardianClient } from "@arkivzk/sdk";
import { httpBlobStore } from "@arkivzk/swarm";

// Reads go through your server's /api/rpc proxy, so the Arkiv access key never reaches the browser.
const rpc = (args) => fetch("/api/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...args }) })
  .then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });
const chain = rabdi({ accessKey: "" });                       // chain metadata only
const publicClient = createPublicClient({ chain, transport: custom({ request: rpc }) });

// Local vault: everything at rest is sealed with a non-extractable WebCrypto key (or a passkey PRF key).
const vault = await Vault.open(new IndexedDBKV(), webCryptoSealer(deviceKey));

const zk = new ArkivZK({
  publicClient,
  vault,
  guardians: [new GuardianClient("https://g1.example"), new GuardianClient("https://g2.example")],
  write: { chain, rpc, publicClient, provider: window.ethereum, account: myAddress },
  blobs: httpBlobStore("/api/swarm"),                         // optional, for attachments
});
```

Node services use `MemoryKV` + `rawKeySealer(key)` and any EIP-1193 provider (see `packages/sdk/e2e.mjs`).

---

## 2. `zk.put` — encrypt, commit, split the key, write once

```ts
const { entityKey, txHash, commitment, expiresAtBlock } = await zk.put({
  schemaId: "medical.v1",
  values: { age: 25, country: "IN", bloodGroup: "O+" },       // up to 8 fields
  attachment: { name: "scan.pdf", type: "application/pdf", bytes },  // optional -> Swarm
  retentionSeconds: 30 * 24 * 3600,                            // data AND keys die after this
}, (step) => console.log(step));
```

What happens:

1. Random 256-bit **DEK**, random 248-bit commitment **salt**.
2. `C = Poseidon2(field_0..field_7, salt)` by executing the Noir `commit` circuit, so it's the exact hash the prover uses.
3. Optional attachment: `AES-GCM(HKDF(DEK,"attachment"), padPow2(file))` uploaded to Swarm.
4. Record JSON (values, salt, field order) is padded to a size bucket and sealed with AES-256-GCM, AAD = `schemaId|recordId`.
5. DEK split **2-of-3** (Shamir over GF(2⁸)): share 1 stays in the vault; shares 2 and 3 are sealed to each guardian's **ML-KEM-768 + X25519** key and stored with an expiry equal to the retention.
6. **One** guarded Arkiv transaction creates the `arkivzk.record.v1` entity (`readonly`, no permissionless extension).
7. If the Arkiv write fails, both guardian shares are destroyed right away, so no key is left behind for data that doesn't exist.

Public on Arkiv: `app`, `schemaId`, `epoch`, `commitment`, padded `ct`, `envId`, optional `swarmRef`, plus Arkiv's own owner/creator/expiry.

---

## 3. `zk.get` — rebuild the key from any two shares

```ts
const { record, attachment } = await zk.get(entityKey);
record.values;          // { age: 25, country: "IN", bloodGroup: "O+" }
```

The device share is used first. A guardian is contacted only for the missing share (one network round trip). The guardian re-seals its share to a fresh one-time ML-KEM key, so the share never travels in the clear even inside TLS.

---

## 4. `zk.prove` — publish a zero-knowledge claim

```ts
const { proofEntityKey, statementText, proveMs } =
  await zk.prove(entityKey, { field: "age", min: 18 }, "pharmacy-42");     // range
await zk.prove(entityKey, { field: "country", equals: "IN" }, "visa-desk");  // equality
```

- Circuit `arkivzk.range.v1` (Noir, UltraHonk, 70 ACIR opcodes) proves: *the record committed in `C` has `fields[slot]` in `[min, max]`*. `min == max` is an equality proof; strings are hashed to field elements.
- `context = H(recordKey, verifierNonce)` is a public input, so a proof made for `pharmacy-42` can't be replayed for another verifier or another record.
- The proof entity expires at the **same block** as its record. A child never outlives its parent.
- The verification key is published once to a **VK registry** entity (`arkivzk.vk.v1`) and reused by every later proof.

---

## 5. `verifyProofEntity` — anyone, no wallet, no keys

```ts
import { verifyProofEntity } from "@arkivzk/sdk";
const r = await verifyProofEntity(publicClient, proofEntityKey);
r.valid;            // true
r.statementText;    // "age >= 18"
r.checks;           // [{ name: "VK equals the audited circuit's VK", ok: true }, ...]
```

Checks, in order: statement bound to the record → known circuit → VK found in the Arkiv registry → registry VK hash matches → VK equals the VK of the circuit shipped in this library → bound to the verifier nonce → public claim matches the public inputs → record is **live** → commitment matches the live record → the UltraHonk proof verifies.
If the record was shredded or expired, the proof is reported as revoked, with a link to the shred receipt.

---

## 6. `zk.shred` — crypto-shredding with a public receipt

```ts
const { receipts, txHash, deleted } = await zk.shred([entityKeyA, entityKeyB], (id, status, detail) => ui.update(id, status, detail));
```

1. One signed `ShredRequest` (controller Ed25519 key) goes to both guardians **in parallel**. Each zeroizes its share and returns a signed destruction attestation bound to `sha256(request)`.
2. At least one guardian attestation is required. With the device share deleted too, at most one share can survive, which is below the threshold of 2.
3. The device share and vault secrets are deleted.
4. **One atomic Arkiv transaction** deletes the records and all their proofs, and creates one `arkivzk.receipt.v1` per record.
5. If step 4 fails, keys are already gone. `zk.publishShredReceipts(keys)` retries only the Arkiv part.

```ts
import { getReceipt, erasureCertificate } from "@arkivzk/sdk";
const rc = await getReceipt(publicClient, receipts[0]);  // verifies controller + guardian signatures
const cert = erasureCertificate(rc, txHash);              // JSON certificate, GDPR Art. 17 style
```

---

## 7. Leases — renew, reminders, guaranteed lapse

Arkiv caps one lease at ~182 days. Data and keys must be renewed **together**. If data outlives its keys it's lost, and if keys outlive data the user didn't get the erasure they expected.

```ts
import { LeaseManager, reminderIcs } from "@arkivzk/sdk";
const lease = new LeaseManager(zk);

const soon = await lease.expiringSoon(7 * 86400_000);              // for the banner
await lease.renew(soon.map((r) => r.entityKey), 30 * 86400);       // +30 days
const ics = reminderIcs(soon[0], 3, "https://app.example/vault");  // calendar reminder 3 days before
```

`renew` order: guardians first (one batched call each, both in parallel), then **one** Arkiv transaction that extends every record **and its proofs**, capped at Arkiv's max lifetime. If you don't renew, the guardians' sweeper destroys their shares at expiry and `zk.list()` drops the device share. Erasure happens even if the user never comes back.

---

## 8. Query planner — SQL-style queries over Arkiv

```ts
import { QueryPlanner, ZkRecord, ZkProof } from "@arkivzk/sdk";
const q = new QueryPlanner(publicClient);

console.log(q.explain({ from: ZkRecord, where: { app: "arkivzk", schemaId: "medical.v1", epoch: { startsWith: "2026-" } }, ownedBy: me }));
// QUERY PLAN for arkivzk.record.v1
//   Arkiv (indexed, server-side): app "arkivzk" AND schemaId "medical.v1" AND epoch {"startsWith":"2026-"} AND $owner = 0x…
//   Client-side:                  (none)
//   Projection:                   $key, app, schemaId, epoch, commitment, swarmRef
//   Pagination:                   keyset($key)
//   Cost:                         1 x 1..n page(s) of 100, 10 quota units each

const { rows, queries } = await q.run({ from: ZkProof, where: { recordKey: { in: myKeys } } });  // IN-batching
await q.proofsFor(myKeys);                    // hasMany: proofs of many records, ceil(n/20) queries
await q.proofsAddressedTo("pharmacy-42");     // ZK query: everyone who answered my challenge
await q.recordsOf(me, "medical.v1");          // metadata only, ciphertext not downloaded
```

| Feature | What it does |
|---|---|
| Predicate pushdown | indexed columns and `$key/$owner/$creator/$expiresAt` are filtered by Arkiv; other columns client-side, with a warning |
| Narrow projection | `bytes` columns (ciphertext, proofs) are never selected unless asked |
| Keyset pagination | `ORDER BY $key` + `$key > cursor` instead of `OFFSET` |
| IN-batching | `{ in: [...] }` becomes `OR` groups of 20 |
| `explain()` | shows the plan and quota cost before running it |
| `liveKeys()` (internal) | existence + expiry of k entities in ⌈k/20⌉ queries |

---

## 8b. Two-level keys and shred levels

```
content key = HKDF( recordDEK ‖ collectionKey )      collection = schemaId × month
              2-of-3      2-of-3
```

```ts
await zk.shred([entityKey]);                                   // record: one record key
await zk.shredCollections([{ schemaId: "medical.v1", epoch: "2026-11" }], "collection");
await zk.shredEpoch("2026-11");                                // every collection of that month
await zk.shredAccount();                                       // everything + vault identity
```

Collection/epoch shred destroys **one key per collection**. Every record encrypted under it dies at once, including records created on another device that this vault never saw. The guardian request also carries the record keys this vault knows about (hygiene), all in one round trip.

## 8c. One-time signers + gas relayer (unlinkable owners)

```ts
import { httpRelayer } from "@arkivzk/sdk";
const zk = new ArkivZK({ ...cfg, signer: "ephemeral", relayer: httpRelayer("/api/relayer") });
await zk.put({...});   // $owner on Arkiv = a fresh address, funded by the shared relayer pool
```

- Each record gets a fresh secp256k1 key. It's stored sealed inside `envId` (only your envSecret opens it), so you can still delete or extend the record after recovering on a new device.
- Before each write the signer proves key possession to the relayer (signed message, 2-minute freshness, per-IP rate limit, 0.05 tGLM cap per top-up). The relayer tops it up just enough for that transaction's gas cap.
- On-chain, every one-time signer is funded by the **same pool address**. The anonymity set is everyone using that relayer. The relayer operator sees the request IP.
- Trade-off: k records with k different owners need k transactions for shred/renew. arkivzk sends them **in parallel**, so latency stays about one transaction, but fees are k×.

## 8d. Blind-index search on encrypted fields

```ts
await zk.put({ schemaId: "medical.v1", values: { age: 25, country: "IN", bloodGroup: "O+" }, searchable: ["country", "bloodGroup"], retentionSeconds });
const { keys, queries } = await zk.search("medical.v1", "country", "in");   // normalized: trim + lowercase
```

Tag = `HMAC(HKDF(envSecret, schemaId‖month), field ‖ 0x00 ‖ value)` in indexed columns `bix0..bix2`. Arkiv only sees random-looking tags. Leakage, stated plainly: two of **your** records in the same month with the same value get the same tag, so equality is visible within that month. Across months and across users, tags don't link.

## 8e. Range, COUNT, JOIN and cascade on encrypted data

```ts
// write: one numeric field (integer 0..255) range-indexed, and an optional parent (blind foreign key)
const visit = await zk.put({ schemaId: "medical.v1", values: { age: 30, country: "IN" }, rangeField: "age", searchable: ["country"], retentionSeconds });
const lab   = await zk.put({ schemaId: "lab.v1", values: { age: 30, hb: 13 }, parent: visit.entityKey, retentionSeconds });

// range: Arkiv evaluates <= 14 OR terms per month; it never sees 18, 40 or any age
const { keys, queries, nodes } = await zk.searchRange("medical.v1", "age", 18, 40);

// COUNT without downloading a single row (Arkiv's native count over the tags)
const { count } = await zk.count("medical.v1", "age", { min: 18, max: 40 });
const { count: inIndia } = await zk.count("medical.v1", "country", { eq: "IN" });

// JOIN parent -> children (1 indexed query + keyset pages)
const { keys: children } = await zk.childrenOf(visit.entityKey);

// cascade: parent + all descendants this vault holds, keys destroyed, ONE Arkiv tx
await zk.shred([visit.entityKey], onStep, { cascade: true });
```

| Method | Time | Space | Arkiv queries |
|---|---|---|---|
| `searchRange(min,max)` over E months | O(E·log 256) HMACs + O(k) | O(k) | ⌈14E/18⌉ (+ pages) |
| `count(...)` | O(E·log 256) | O(1) | ⌈terms/18⌉ count queries |
| `childrenOf(parent)` | O(1) HMAC + O(k) | O(k) | ⌈k/100⌉ |
| `shred(..., {cascade})` | O(depth) BFS queries + O(k) | O(k) | 1 per node visited, **1 tx** |

Live results (`node packages/sdk/query-encrypted.mjs`, docs/query-bench.json):
- range `[18,40]` over 7 encrypted records: 497 ms, 1 query, 0 bytes of ciphertext downloaded. The decrypt-everything baseline took 3,034 ms, 7 decrypts and 2,296 B, and returned the identical result set.
- count: 372 ms.
- join: 341 ms.
- cascade shred of parent + child: 1 tx.

Full comparison against Arkiv's native query language, and what each index leaks: [07 §5](07-performance.md#5-queries-what-arkiv-does-what-it-cant-do-on-encrypted-data-and-what-arkivzk-adds).

## 8f. Relational layer: atomic inserts, 1:N, M:N, cascade

```ts
// one atomic transaction: patient, doctor, a visit linking both (M:N junction), a lab result (1:N)
const [patient, doctor, visit, lab] = await zk.putMany([
  { schemaId: "patient.v1", values: { age: 30 }, retentionSeconds: 2 * HOUR },
  { schemaId: "doctor.v1",  values: { speciality: "cardio" }, retentionSeconds: 2 * HOUR },
  { schemaId: "visit.v1",   values: { day: 12, fee: 40 }, retentionSeconds: 2 * HOUR,
    parents: [{ key: { index: 0 }, relation: "visit" }, { key: { index: 1 }, relation: "visit" }] },
  { schemaId: "lab.v1",     values: { hb: 13 }, retentionSeconds: 24 * HOUR,          // clamped to the patient's expiry
    parents: [{ key: { index: 0 }, relation: "lab" }] },
]);

await zk.childrenOf(patient.entityKey, "lab");               // 1:N   -> [lab]
await zk.childrenOfMany([p1, p2, p3, p4, p5]);               // batched JOIN: 1 query instead of 5
await zk.parentsOf(lab.entityKey);                           // belongsTo, no query
await zk.linked(patient.entityKey, "visit");                 // M:N   -> doctor (via the visit junction)
await zk.orphans();                                          // live records whose parent is gone
await new LeaseManager(zk).renew([patient.entityKey], 3600, step, { cascade: true }); // whole tree, 1 tx
await zk.shred([patient.entityKey], onStep, { cascade: true });                       // whole tree, 1 tx
```

| Method | Time | Space | Arkiv |
|---|---|---|---|
| `putMany(rows)` | O(rows) crypto | O(rows) | **1 tx** (≤ 10 rows) |
| `childrenOf` | O(1) + O(k) | O(k) | 1 query (+ pages) |
| `childrenOfMany(P)` | O(P) HMACs + O(k) | O(P + k) | ⌈P/9⌉ queries |
| `parentsOf` | O(1) | O(1) | 0 |
| `linked` | O(k) | O(k) | 1 query |
| `orphans` | O(R) | O(R) | ⌈P/20⌉ queries |
| cascade shred / renew | O(tree) | O(tree) | depth queries + 1 tx per owner |

Rules arkivzk enforces, because Arkiv leaves them to apps:
- the parent must be live;
- a child never outlives its parents;
- at most 2 parents per row;
- relations survive device loss (they are inside the ciphertext).

Full table and live numbers: [07 §6](07-performance.md#6-relational-layer-on-encrypted-data).

## 9. Recovery (lost device)

```ts
const kit = vault.exportRecoveryKit("a long passphrase you keep offline");   // scrypt N=2^17 + AES-GCM
// new device:
const vault2 = await Vault.importRecoveryKit(new IndexedDBKV(), sealer, kit, passphrase);
const zk2 = new ArkivZK({ ...cfg, vault: vault2 });
await zk2.recover(myWalletAddress);   // wallet mode: ownedBy(wallet). Ephemeral mode: scans arkivzk records and keeps those whose envId opens
// keys come back from the 2 guardian shares (record key + collection key)
```

---

## 10. Archive node + "break it"

```bash
ARKIV_ACCESS_KEY=… node archive/dist/indexer.js      # GET /captures, GET /captures/<txHash>
```

```ts
const { success, log } = await zk.tryDecryptCaptured(ctFromArchive, envIdFromArchive, "medical.v1", "2026-11");
// before shred: success=true (the owner can still read the archived copy)
// after shred:  success=false, "fewer than 2 key shares exist - this record's key is destroyed"
```

---

## 11. Guardian service

```bash
GUARDIAN_NAME=guardian-1 PORT=7101 node guardian/dist/server.js
# GUARDIAN_PERSIST_SHARES=1 to survive restarts (shares overwritten + fsync'd + unlinked on shred)
```

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /info` | – | name, Ed25519 + ML-KEM public keys, shares held |
| `POST /shares` | controller sig | store a sealed share with an expiry |
| `POST /shares/fetch` | controller sig + nonce | release the share sealed to a one-time client key |
| `POST /shares/extend` | controller sig + nonce | batch lease extension (leases only grow) |
| `POST /shred` | controller sig + nonce | zeroize + signed destruction attestation |
| `GET /expired` | – | recent automatic expiry erasures |

Requests older than 5 minutes are rejected, and nonces can't be replayed.

---

## 12. Guarded writes (`@arkivzk/core`)

Every write goes through `guardedBatch`, which follows Arkiv's Rabdi write-safety policy:
exact unsigned gas estimate (signing blocked) → `gas = max(1,000,000 + 400,000·(ops−1), 2·estimate)` ≤ ½ block gas limit → latest nonce must equal pending → balance and max-fee check → explicit `{gas, gasPrice, nonce}` → `receipt.status === "success"`. It never resends automatically.
