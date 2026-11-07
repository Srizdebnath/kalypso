# 08 · Why this lives on top of Arkiv (design FAQ)

Arkiv's query language has equality, ranges, `STARTSWITH`, `EXISTS`, AND/OR, one sort key and filtered counts. It has no JOINs, no foreign keys, no `IN`, no `NOT`, and no aggregates beyond count. Kalypso adds encrypted search, encrypted counts and a relational layer on top of it. This page explains why those features belong in a library rather than in Arkiv itself, and what we do and don't claim.

## Short version

Kalypso doesn't patch Arkiv or work around a missing feature. It **compiles** encrypted and relational queries down to primitives Arkiv already has:
- indexed equality
- `OR`
- `count()`
- atomic batches
- absolute expiry

Nothing in Arkiv changes, and it all runs on Rabdi today. Every result on these pages comes from a live script with real transaction hashes.

## Why Arkiv's base layer doesn't do this, and shouldn't

**1. Arkiv nodes never hold user keys.**
- Arkiv is a public DB-chain: every node indexes the same public attributes.
- A query over *encrypted* values can't run on the node unless the node can decrypt. That would break the privacy model.
- The other server-side options, FHE or ORAM, are orders of magnitude too slow for a shared chain.
- So encrypted search has to be a protocol between the client and public tags. That is a library's job.

**2. The query language is small on purpose.**
- Every node has to evaluate every query deterministically, at a bounded cost.
- The docs list node limits on query length and nesting depth (`QueryError` kind `limits`), and the hosted RPC charges a flat quota per query.
- JOINs and aggregates have unbounded cost on a public endpoint.
- Kalypso keeps every query inside those limits: at most 18 OR terms per query, with batching and keyset paging.

**3. Leakage is a product decision.**
- Each index leaks something: an equality tag shows equality within a month, a range tag shows approximate order, a foreign key shows siblings.
- Whether that leak is acceptable depends on the app. A base layer can't pick it for every app.
- Kalypso makes each index opt-in per field and documents what it leaks ([07 §5.4](07-performance.md#54-what-this-leaks-stated-plainly), [§6.3](07-performance.md#63-what-the-relational-tags-leak)).

**4. Arkiv's own guidance assigns relations to apps.**
- From the data-modeling skill: "the SDK does not enforce foreign keys, uniqueness or cascading deletion".
- From the arkiv-graph package: "Relationships are application rules, not native joins".
- The same guidance warns that children can outlive parents unless the app uses the parent's absolute deadline.
- Kalypso implements exactly those rules ([07 §6](07-performance.md#6-relational-layer-on-encrypted-data)).

## Questions we expect, with straight answers

| Question | Answer |
|---|---|
| "Are you saying Arkiv is missing features?" | No. On **plaintext** Arkiv already does equality, range and count server-side. We add the **encrypted** versions, plus app-level relational rules that Arkiv's docs say apps should own. |
| "Does the blind index leak?" | Yes, and the leak is bounded. Equal values of *your* records in the *same month* share a tag. Tags don't link across months or users. Every index is opt-in. |
| "Does the range index leak order?" | Approximate order *within one month*, at 8 bucket sizes. That is the price of server-side range search on ciphertext. Records written without `rangeField` leak nothing. |
| "Why not an order-preserving encryption scheme?" | OPE leaks exact order globally and has known attacks. Per-month HMAC tree tags leak less and are easy to explain. |
| "Is the speedup real?" | Every number is measured on Rabdi, with the baseline result asserted equal: range search 3,034 ms → 497 ms on 7 records; batched JOIN 5 → 1 query; listing 2,432 B → 167 B. The rows for 1k and 10k records are labelled *extrapolated* from per-record cost. |
| "What if a guardian keeps its share?" | One guardian alone is below the threshold (2-of-3, and the device share is gone). Two colluding guardians could keep a key. Shred receipts prove they *signed* destruction, not that memory was wiped. TEE attestation is not implemented. |
| "Is this production ready?" | No. It's a hackathon project: research-grade, not audited, local guardians. |
| "Does deleting on Arkiv erase data?" | No, and we say so. Calldata stays in history and in archives. Erasure comes from destroying keys (crypto-shredding), which the archive node page lets anyone test. |

## What we deliberately don't claim

- "Zero leakage". Every index leaks something; each one is documented and opt-in.
- That Arkiv can't do range search, count or similar queries. It can, on plaintext.
- That guardians are trustless.
- Speedups at scale beyond what we measured. Rows for larger N are marked as extrapolated.

## Where to check

| Claim | Run |
|---|---|
| Full lifecycle (put, prove, verify, search, renew, shred, archive) | `node packages/sdk/e2e.mjs` |
| Encrypted range / count / JOIN vs decrypt-everything | `node packages/sdk/query-encrypted.mjs` |
| Relational layer (atomic insert, 1:N, M:N, N+1, orphans, cascade, recovery) | `node packages/sdk/relational.mjs` |
| Query planner (IN-batching, keyset, projection) | `node packages/sdk/query-live.mjs` |
| Public receipts, no wallet needed | `node packages/sdk/query-receipts.mjs` |
