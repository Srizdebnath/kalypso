# 07 · Performance: complexity, measurements, optimizations

Every number on this page was measured by scripts in this repo: `packages/sdk/bench.mjs` (local, results in `docs/bench.json`) and `packages/sdk/e2e.mjs` (live on Arkiv Rabdi, results in `docs/e2e-timings.json`). Machine: laptop, Node 24, single process. Your numbers will differ. Re-run the scripts.

## Notation

| Symbol | Meaning |
|---|---|
| `n` | plaintext record size in bytes |
| `k` | records in one call (shred / renew) |
| `p` | proofs per record |
| `g` | guardians (2) |
| `c` | size of an `IN (...)` list |
| `m` | rows matching the indexed predicates |
| `P` | page size (Arkiv max 100) |
| `R` | records in the local vault |
| RTT | one network round trip |

---

## 1. Complexity of every operation

| Operation | Local time | Local space | Network | Arkiv writes | On-chain bytes |
|---|---|---|---|---|---|
| `put` | O(n) encrypt + O(1) commit/split/HPKE | O(n) | 1 guardian RTT (both in parallel) + 1 tx | 1 tx, 1 op | O(bucket(n)) ≤ 4·(n+4)+28 |
| `put` with attachment of size `a` | O(n + a) | O(n + a) | + 1 Swarm upload | same | Swarm: next pow2 ≥ a+8 |
| `get` | O(n) | O(n) | 1 Arkiv read + **≤ 1** guardian RTT | – | – |
| `prove` | **O(1) in n** (fixed 8-slot circuit) | O(1) | 2 Arkiv reads + 1 tx | 1 tx, 1–2 ops | proof 14,656 B + statement (+ VK 3,680 B **once ever**) |
| `verifyProofEntity` | O(1) | O(1) | 3 Arkiv reads (+1 if record not live) | – | – |
| `shred(k)` | O(k) | O(k) | **1** guardian RTT + 2·⌈k(1+p)/20⌉ queries + 1 tx | **1 tx**, k(1+p) deletes + k creates | k receipts |
| `renew(k)` | O(k) | O(k) | **1** guardian RTT + 2·⌈k(1+p)/20⌉ queries + 1 tx | **1 tx**, k(1+p) extensions | – |
| `QueryPlanner.run` | O(m) client filter | O(m · projection) | ⌈c/20⌉ · ⌈m/P⌉ queries | – | – |
| `proofsFor(keys)` | O(c) | O(c) | ⌈c/20⌉ queries | – | – |
| `shredEpoch` / `shredCollections(C)` | O(C + k_known) | O(C) | **1** guardian RTT | 1 tx per owner (wallet mode: 1) | k receipts |
| key operations to kill all records of a month | **O(1) per collection**, independent of record count | | | | |
| `search(field, value)` over E months | O(E) HMACs | O(E) | ⌈3E/18⌉ queries | – | – |
| `put` in ephemeral mode | + 1 secp256k1 keygen | | + relayer RTT + funding tx | 1 tx | – |
| `list` | O(R) vault decrypts | O(R) | 0 | – | – |
| `recover` | O(R) | O(R) | ⌈R/100⌉ queries + R × (1 read + 2 guardian RTT) | – | – |
| guardian sweeper | O(shares) every 10 s | O(1) | 0 | – | – |

Why `prove` is O(1) in the record size: the circuit always hashes exactly 8 field slots + salt and checks one slot. A 3-field record and an 8-field record cost the same. Strings enter the circuit as a 248-bit hash, so their length doesn't matter either.

---

## 2. Measured: local primitives (`docs/bench.json`)

| Primitive | Time | Size |
|---|---|---|
| Poseidon2 commitment (Noir execute) | 3.9 ms | 32 B |
| **Prove** range (UltraHonk, WASM, warm) | **370 ms** | proof **14,656 B** |
| **Verify** range | **15 ms** | VK 3,680 B |
| Range circuit | 70 ACIR opcodes | 5 public inputs |
| AES-256-GCM seal 256 B / 4 KiB / 64 KiB | 1.6 / 1.3 / 9.4 ms | +28 B |
| Shamir split 32 B (2-of-3) / combine | 0.37 / 0.04 ms | 3 × 33 B |
| ML-KEM-768+X25519 keygen | 3.8 ms | |
| HPKE seal / open one share | 13.3 / 10.0 ms | sealed share in `bench.json` |
| Ed25519 sign / verify | 2.3 / 5.6 ms | 64 B |
| scrypt N=2¹⁷ (recovery kit) | 1,234 ms | deliberately slow |

First proof in a fresh process also pays a one-time WASM + SRS setup cost (≈1–4 s observed). Later proofs reuse one shared Barretenberg instance.

---

## 3. Before vs after: what we optimized and why

### 3.1 Shred k records

| | Before (naive) | After (Kalypso) |
|---|---|---|
| Arkiv transactions | k·(1+p) deletes + k receipt creates = k(2+p) txs | **1 atomic tx** |
| Wallet confirmations | k(2+p) | **1** |
| Gas cap reserved (Rabdi policy floor) | k(2+p) × 1,000,000 | 1,000,000 + 400,000·(k(2+p)−1) |
| Guardian round trips | 2k sequential | **1** (one batched request per guardian, both in parallel) |
| Existence checks | k(1+p) `getEntity` calls | ⌈k(1+p)/20⌉ `$key IN` queries |
| Partial failure | some records deleted, some not | all-or-nothing on Arkiv; keys destroyed first, receipt publish retryable |

Example k=10, p=1: 30 txs → 1 tx. Reserved gas cap 30,000,000 → 12,600,000 (−58%). These are reserved caps under the Rabdi policy, not gas actually used. Gas used is in §4.

### 3.1b Kill a whole month of data

| | Before (record keys only) | After (two-level keys) |
|---|---|---|
| Key destructions for N records in a month | N | **1** (collection key) |
| Records on other devices / not in this vault | missed | **also dead** (they share the collection key) |
| Guardian round trips | 1 (batched) | 1 |

### 3.1c Ownership privacy (ephemeral mode)

| | Wallet mode | Ephemeral mode |
|---|---|---|
| `$owner` of your records | your wallet (linkable) | fresh address per record, funded by shared pool |
| Shred/renew of k records | 1 tx | k txs **in parallel** (≈1 tx latency, k× fees) |
| Recovery lookup | `ownedBy(wallet)`: ⌈R/100⌉ queries | scan of Kalypso records: ⌈N/100⌉ queries (N = all Kalypso records) |

### 3.2 Renew k records

| | Before | After |
|---|---|---|
| Arkiv txs | k(1+p) extend txs | **1 tx** |
| Guardian calls | 2k (one per record per guardian) | **2 in parallel (1 RTT)**: per-record expiries in one request |
| Consistency | keys and data renewed separately, can diverge | guardians first (keys never die before data), children capped to parent |

### 3.3 Verification keys

| | Before | After |
|---|---|---|
| VK bytes on Arkiv for P proofs | 3,680 · P | **3,680 once** (`arkivzk.vk.v1` registry, deduped by `vkHash`) |
| Trust in VK | whatever the prover attached | registry VK must hash to `vkHash` **and** equal the VK of the circuit shipped in the library |

### 3.4 Reads

| Query | Before | After |
|---|---|---|
| Proofs of c records | c queries | ⌈c/20⌉ queries (`IN`-batching) |
| List my records | download every ciphertext (≤120 KiB each) | metadata projection only (`bytes` columns skipped) |
| Paging | `OFFSET`: rows shift when entities expire between pages | keyset on `$key`: stable cursor |
| Non-indexed filter | silent full scan | `explain()` warns before running |
| Quota (10 units/query) | grows with c and k | divided by 20 for batched lookups |

### 3.5 `get`

| | Before | After |
|---|---|---|
| Guardian calls per read | 2 | **≤1** (device share first, stop at threshold) |
| Share on the wire | TLS only | sealed to a one-time ML-KEM-768+X25519 key per request |

### 3.6 Correctness choices that cost something (trade-offs, stated plainly)

| Choice | Cost | Why we pay it |
|---|---|---|
| Padding to buckets | up to 4× ciphertext size for small records | hides exact size from every archive forever |
| Attachment padding to pow2 | up to 2× Swarm storage | same, for files |
| Commitment via Noir `execute` instead of a JS Poseidon port | ~4 ms vs sub-ms | the commitment is guaranteed to be the circuit's own hash; no second implementation to drift |
| Explicit 2× gas headroom | higher reserved gas | follows Arkiv's measured Rabdi policy; we never resend automatically |
| HPKE on shares inside TLS | ~23 ms per share round trip | shares stay safe against "harvest now, decrypt later" even if TLS logs leak |

---

## 4. Measured: live on Arkiv Rabdi

Filled from `docs/e2e-timings.json` by running `node packages/sdk/e2e.mjs` against Rabdi with real guardians.

Run of 2026-11-06 (UTC), signer `0xBc670380edc8Ac07E91ca68cD6ac2Adf27881162`, two local guardian processes, Rabdi gasPrice 1 gwei. Wall-clock times include waiting for the receipt (Rabdi block time 2 s).

| Step | Wall time | Gas used | Notes |
|---|---|---|---|
| `put` (commit + encrypt + 2 guardians + 1 tx) | 10.0 s | 196,679 | ciphertext on chain: 1,052 B (padded bucket) |
| `get` (2 shares + decrypt) | 0.40 s | – | no transaction |
| `prove` + publish, **first proof ever** (proof + VK registry entry) | 10.6 s | 1,379,044 | VK written once |
| `prove` + publish, VK already registered | 8.1 s | **575,746** | −58% gas: VK not re-uploaded (§3.3) |
| `verifyProofEntity` (public, no keys) | 1.2 s | – | 9 checks, all pass |
| `search` (blind index, 1 month) | 0.37 s | – | 1 query |
| `proofsAddressedTo` | 0.42 s | – | 1 query |
| `renew` record + proof (+ both guardians) | 6.7 s | 78,157 | 2 extensions in **1 tx** |
| `shred` (guardians + 2 deletes + 1 receipt, **1 tx**) | 9.8 s | 792,641 | |
| `shredEpoch` (collection key, 2 keys destroyed) | 9.2 s | – | second record became undecryptable without touching it |
| `put` in ephemeral mode (incl. relayer funding tx) | 17.1 s | – | 2 sequential txs: funding + create |
| `shred` in ephemeral mode | 16.3 s | – | funding + delete/receipt |

Proof size on chain: 14,656 B. After the shred, the archive-capture step re-read the ciphertext an archive node would keep and tried to decrypt it. Both guardians answered "no share", the device shares were gone, and decryption failed. Three receipts from this run are live and checkable with `node packages/sdk/query-receipts.mjs`.

Where the time goes: almost all of `put`/`prove`/`shred` is waiting for block inclusion and the receipt (2–5 blocks). The crypto itself is in §2 (prove 370–640 ms, the rest < 20 ms).

---

## 5. Queries: what Arkiv does, what it can't do on encrypted data, and what Kalypso adds

Sources: Arkiv [query language reference](https://docs.arkiv.network/reference/query-language) and [limits](https://docs.arkiv.network/reference/limits), SDK 1.0.1 declarations. Measured numbers below come from two live scripts on Rabdi:
- `packages/sdk/query-live.mjs`, results in `docs/query-live.json`: the query planner on public metadata.
- `packages/sdk/query-encrypted.mjs`, results in `docs/query-bench.json`: queries over encrypted fields. It writes real records, checks every answer against the decrypt-everything baseline, then shreds them.

### 5.1 Capability matrix

| Query | Arkiv on **plaintext** attributes | Arkiv on **encrypted** data (values are ciphertext in `bytes`) | Kalypso on encrypted data |
|---|---|---|---|
| Equality `f = v` | ✅ `eq` on indexed column | ❌ `bytes` can't be indexed or filtered | ✅ blind index (`search`) |
| Range `a ≤ f ≤ b` | ✅ `between/gt/lt` | ❌ | ✅ range index (`searchRange`), 0..255 domain |
| `IN (…)` | ⚠️ no `IN`; write `or(eq…)` by hand, bounded by query-size limit | ❌ | ✅ auto-chunked `IN` (`QueryPlanner`, `proofsFor`, `liveKeys`) |
| `COUNT(*) WHERE …` | ✅ `client.count()` | ❌ (count of *what*? the values are hidden) | ✅ `count()` over blind/range tags, 0 rows downloaded |
| `SUM/AVG/MIN/MAX`, `GROUP BY` | ❌ not in the language | ❌ | ⚠️ not server-side; owner computes after decrypt. A *proof* about a value is `prove()` (ZK) |
| `JOIN` / foreign keys | ❌ no joins; schema is a convention, no FK constraint | ❌ | ✅ blind foreign key `rel` + `childrenOf()` (1 query); public FK `recordKey` for proofs (`proofsFor`, batched) |
| Cascade delete | ❌ | ❌ | ✅ `shred(keys, …, { cascade: true })`: children found by blind FK, all deleted in **1 tx**, keys destroyed |
| `ORDER BY` | ✅ one attribute | ⚠️ ordering ciphertext is meaningless | ⚠️ by public fields (`$key`, `$expiresAt`, epoch); value order only after decrypt (deliberate: an order-revealing tag leaks far more) |
| Prefix `STARTSWITH` | ✅ `str` only | ❌ | ❌ by design (prefix tags would leak string structure) |
| `NOT`, `!=` | ❌ SDK exports neither | ❌ | ❌ (complement of a range is two ranges: `searchRange` twice) |
| Pagination | `OFFSET` or keyset on `$key`, max 100 rows/page | same | keyset everywhere, stable under expiry |
| Explain / plan | ❌ | ❌ | ✅ `QueryPlanner.explain()` (pushdown vs client-side, projection, cost) |

### 5.2 Complexity before vs after, every query optimization

`N` = Kalypso records of that schema, `k` = matching rows, `c` = keys in an `IN`, `E` = months (epochs) searched, `P` = 100 (page size), `|ct|` = ciphertext size (≥ 256 B padded, ≤ 120 KiB).

| Optimization | Before: time / space / Arkiv queries | After: time / space / Arkiv queries | Measured on Rabdi (before → after) |
|---|---|---|---|
| Equality on encrypted field | O(N) decrypts + 2N guardian RTTs / O(N·\|ct\|) download / ⌈N/P⌉ | O(E) HMACs + O(k) / O(k) / ⌈3E/18⌉ | 7 records: 3,034 ms, 7 decrypts → **394 ms, 1 query, 0 decrypts** |
| Range on encrypted field | same as above | O(E·log D) tree cover, ≤ 14 terms per month (D = 256) / O(k) / ⌈14E/18⌉ | 7 records: 3,034 ms, 2,296 B ciphertext → **497 ms, 1 query, 0 B ciphertext**; same 3 hits |
| COUNT on encrypted field | O(N) decrypts / O(N·\|ct\|) / ⌈N/P⌉ | O(E·log D) / **O(1)** (one number) / ⌈terms/18⌉ | **372 ms, 1 count query, 0 rows** |
| JOIN parent → children (encrypted FK) | impossible without decrypting every record: O(N) | O(1) HMAC + O(k) / O(k) / ⌈k/P⌉ | **341 ms, 1 query** |
| Cascade delete parent + children | k+1 separate txs, children found by O(N) scan | 1 BFS query per level + **1 tx** | parent + child: **1 tx**, both keys destroyed, child gone from Arkiv |
| `IN` lookup of c keys (`proofsFor`) | c queries | ⌈c/20⌉ queries | c = 45: **45 → 3 queries** (−93%) |
| Existence of c keys (`liveKeys`) | c `getEntity` calls | ⌈c/20⌉ queries | c = 45: **45 → 3 queries**, 467 ms total |
| List records (projection) | every column incl. ciphertext: O(N·\|ct\|) | metadata only: O(N·m), m ≈ 170 B | 1 record: **2,432 B → 167 B** (−93%); the gap grows with \|ct\| up to 120 KiB |
| Paging | `OFFSET`: rows shift if an entity expires between pages (skips/duplicates) | keyset on `$key`: O(1) per page, stable | page size 1 vs 100 over 10 rows: **identical order**, 11 vs 1 queries |
| Non-indexed filter | silent full scan | `explain()` warns before running | – |
| Quota (10 units/query) | grows with N (scan) or c | divided by P or 20 | 45-key lookup: 450 → 30 units |

**How "before" scales** (measured per-record cost × N; the "after" query count doesn't grow with N, only with matches k):

| N records | Before: download + decrypt everything | After: range/equality/count |
|---|---|---|
| 7 (measured) | 3.0 s, 7 decrypts, 14 guardian RTTs, 2.3 KB | 0.4–0.5 s, 1 query |
| 1,000 (extrapolated, 433 ms/record) | ~7 min, 2,000 guardian RTTs, ≥ 328 KB (up to 120 MB) | 1 query + ⌈k/100⌉ pages |
| 10,000 (extrapolated) | ~72 min, 20,000 guardian RTTs, ≥ 3.3 MB | 1 query + ⌈k/100⌉ pages |

The "before" path also needs every record's keys to still exist, so a third party can never run it. The "after" tags can be computed by anyone holding the per-month search key, which can be handed out separately from the decryption keys.

### 5.3 How the encrypted range index works

- **Write:** for one numeric field `v ∈ [0, 255]`, store 8 tags `r_l = HMAC(K_month, field‖l‖(v >> (8−l)))`, for l = 1..8. Each tag is the node containing `v` at that tree level. Cost is 8 HMACs and 8 indexed `str` columns.
- **Query:** the canonical cover of `[a, b]` is the minimal set of tree nodes whose buckets exactly tile the range. It has at most 2 nodes per level and **at most 14 in total**: we checked all 32,896 ranges exhaustively, and every cover is exact with no overlap. Each node becomes one `eq("r_l", tag)` term, and Arkiv ORs them server-side.
- **Count:** the same terms go into `client.count()`. A record matches exactly one node, so there is no double counting.
- **Key scope:** `K_month = HKDF(envSecret, schema|month)`, so tags from different months can't be linked. Shredding the identity removes the ability to compute them.

### 5.4 What this leaks (stated plainly)

| Index | Visible to anyone reading Arkiv | Not visible |
|---|---|---|
| Blind equality tag | which of *your* records in the same month share a value (equality pattern) | the value; links across months; other users' tags |
| Range tags | which of your records in the same month fall in the same bucket at each of 8 granularities, i.e. **approximate order within a month** | the values, the bounds you query (only which tags are asked for, if someone watches your RPC) |
| Blind FK `rel` | which records are siblings (same parent tag) | which record is the parent; the parent's recordId |
| No index (default) | nothing beyond size bucket, epoch, schemaId | everything |

Indexes are opt-in per field (`searchable`, `rangeField`, `parent`). Leave them off for fields where even equality patterns are sensitive.

---

## 6. Relational layer on encrypted data

Arkiv's own guidance, verbatim:
- [data-modeling skill]: "the SDK does not enforce foreign keys, uniqueness or cascading deletion".
- [arkiv-graph]: "Relationships are application rules, not native joins or foreign-key constraints".
- The same data-modeling guidance warns that "related entities created later with the same relative lifetime can outlive their parents; use the parent's observed absolute deadline".

So relations belong in the app layer. Kalypso implements them, and the keys never leave the client. Live check: `node packages/sdk/relational.mjs`, results in `docs/relational-bench.json`, every step asserted.

### 6.1 What maps to what

| SQL / relational concept | Kalypso | On Arkiv |
|---|---|---|
| `INSERT` several rows in one transaction | `putMany([...])` | one `execute` batch, so all rows succeed or none do (Arkiv batches are atomic) |
| Foreign key (1:N) | `parents: [{ key, relation }]` | indexed `rel = HMAC(K_rel, relation‖parentRecordId)`: Arkiv can't tell which record is the parent |
| Junction table (M:N) | a row with 2 parents | `rel` + `rel2` |
| `REFERENCES … ` must exist | parent must be live at insert | checked before any key is created |
| Child lifetime ≤ parent | expiry clamped to the earliest parent `$expiresAt` (absolute block) | `ExpirationTime.atBlock(parentExpiry)` |
| `JOIN` parent → children | `childrenOf(key, relation)` | 1 indexed query |
| `JOIN` for many parents | `childrenOfMany(keys)` | ⌈P/9⌉ OR queries (2 terms per parent), no N+1 |
| belongsTo | `parentsOf(key)` | 0 queries: in the sealed vault, and inside the ciphertext for recovery |
| M:N lookup | `linked(key, relation)` | 1 query + local vault lookups |
| Dangling FK check | `orphans()` | ⌈P/20⌉ `$key IN` liveness queries |
| `ON DELETE CASCADE` | `shred(keys, …, { cascade: true })` | keys destroyed for every descendant, deletes + receipts in **1 tx** per owner |
| `ON UPDATE CASCADE` (lease) | `LeaseManager.renew(keys, s, …, { cascade: true })` | children extended in the same tx, still clamped ≤ parent |
| Restore after device loss | `recover()` | parent recordIds are inside each ciphertext, re-linked to entity keys after the scan |

### 6.2 Complexity before vs after

`P` = parents, `k` = children/matches, `N` = all records, `d` = tree depth.

| Operation | Before (plain Arkiv, encrypted values) | After (Kalypso) | Measured on Rabdi |
|---|---|---|---|
| Insert parent + children | k+1 txs; children can be created after the parent died; no atomicity | **1 tx**, all-or-nothing | 4 rows (patient, doctor, visit, lab): **1 tx**, 624,808 gas, 11.5 s |
| Children of 1 parent | impossible without decrypting all N: O(N) | O(1) HMAC + 1 query, O(k) | 387 ms, 1 query |
| Children of P parents | P queries (N+1) | ⌈P/9⌉ queries | P = 5: **5 queries / 1,826 ms → 1 query / 389 ms** (−79% time) |
| M:N (patient → doctors) | impossible without decrypting all | 1 query + O(k) local | 521 ms, 1 query |
| belongsTo | O(N) decrypt | O(1), no network | 0 ms, 0 queries |
| Orphan detection | O(N) reads | ⌈P/20⌉ queries | doctor shredded → visit junction reported |
| Cascade shred of a tree | k+1 txs, children found by scan | d BFS queries + **1 tx** | patient + visit + lab: **1 tx**, 10.6 s |
| Cascade renew | k+1 txs, a child could outlive its parent | **1 tx**, child ≤ parent kept | patient + lab + visit: **1 tx**, 11.0 s |
| Lost device | relations lost | rebuilt from ciphertext | 14 records recovered with relations, 7.3 s |

Batches that would break the half-block gas rule are split in halves before signing. Example: shredding 10 rows means 20 operations. Each part is its own atomic transaction, and every part that succeeds is saved right away, so a retry never publishes a duplicate receipt.

### 6.3 What the relational tags leak

| Visible on Arkiv | Not visible |
|---|---|
| that a record has 1 or 2 parents (`rel`/`rel2` set) | which records are the parents |
| siblings: children of the same parent share a `rel` tag | the relation name, the parent's identity, any value |

Relation keys are per identity (`HKDF(envSecret, "arkivzk/rel/v1")`). Destroying the identity (account shred) leaves the tags unlinkable forever.
