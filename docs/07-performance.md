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

| | Before (naive) | After (arkivzk) |
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
| Recovery lookup | `ownedBy(wallet)`: ⌈R/100⌉ queries | scan of arkivzk records: ⌈N/100⌉ queries (N = all arkivzk records) |

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

_Live numbers will be added after the first funded run._
