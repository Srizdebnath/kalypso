# How we use Arkiv

| Arkiv feature | How arkivzk uses it | What the user sees |
|---|---|---|
| **Typed schemas** (`defineSchema`) | 4 schemas: record, proof, vk, receipt ([schema.md](schema.md)) | – |
| **Indexed attributes** | only what verifiers and owners filter on: `commitment`, `recordKey`, `vkHash`, `audience`, `claim`, `schemaId`, `epoch` | verify page, "proofs addressed to me", recovery |
| **`bytes` columns** | ciphertext, proofs, VK, signed attestations: stored, never filtered | – |
| **Expiration** | record lifetime = user's retention choice; guardians destroy keys at the same moment | countdown in the vault, "expires in 3 days" banner, `.ics` reminder |
| **Lifetime extension** (`extendEntity` in a batch) | renew = guardians extend key leases, then ONE tx extends record + all its proofs | "Renew 12 records" = one wallet confirmation |
| **`ExpirationTime.atBlock`** | proofs expire at their record's exact block | a proof never outlives its data |
| **Atomic batches** (`executeBatch`) | shred = delete records + proofs + create receipts in one tx | one confirmation, all-or-nothing |
| **`readonly` flag** | records and proofs can't be patched (only deleted/extended by owner) | tamper-evident records |
| **`permissionlessExtension`** | OFF for user data (no third party can keep it alive); ON for VK registry and receipts (public goods anyone may keep alive) | – |
| **Ownership (`$owner`)** | who may delete/extend; recovery queries `ownedBy(wallet)` | restore on a new device |
| **Queries** (`eq`, `or`, `startsWith`, `$key`, `orderBy`, `limit`) | query planner with pushdown, projections, IN-batching, keyset pagination | query explorer with `EXPLAIN` |
| **Raw calldata (history)** | our archive node captures it to show deletion ≠ erasure | "Old node runner" page + "try to decrypt" |

Every write follows Arkiv's Rabdi write-safety policy (explicit gas/nonce/gasPrice, receipt check, no automatic resend) — see `packages/core/src/tx.ts`.
