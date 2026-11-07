# 01 · Idea, threat model, promises

## The pitch

Arkiv is a great public data layer: cheap, queryable, expiring entities. But "public by default"
blocks every serious use case with personal data: health, identity, finance, chats, HR, KYC.
And GDPR-style "right to be forgotten" is impossible on a chain where old blocks live forever.

**Kalypso** is a TypeScript library that sits between your app and `@arkiv-network/sdk`:

- everything written is **encrypted on the client**,
- everything useful about it is **provable in zero knowledge**,
- anything can be **permanently destroyed by destroying its key** (crypto-shredding),
  so even a node runner who archived every block since genesis is left with noise.

## Arkiv facts we design around

| Fact (from Arkiv docs, SDK 1.0.x on Rabdi) | Consequence for us |
|---|---|
| All attributes, `$owner`, `$creator`, `$expiresAt`, tx metadata are public | Never put plaintext in attributes. Indexed attributes must be blinded or coarse. |
| `bytes()` columns are stored, selectable, **not indexed / not filterable** | Ciphertext, proofs and commitments go in `bytes()` columns. |
| `deleteEntity` = gone from current state, "as if expired" | Old calldata still exists in history and archives. Deletion alone is NOT erasure. |
| Every entity expires (`MAX_LIFETIME`, no expiration-free option) | Keys/key-envelopes can use short lifetimes; data entity lifetime is independent. |
| Ciphertext length is visible | Pad plaintext to fixed buckets. |
| Encryption cannot retract plaintext someone already decrypted | Shredding protects against *future* decryption, not screenshots. We say this out loud. |

## Threat model

| Adversary | Has | We defend? |
|---|---|---|
| Public reader / indexer | All current entities | Yes – sees only ciphertext, commitments, proofs |
| **Old node runner / archive node** | Every historical block, every deleted entity, forever | **Yes – after shred, all their copies are undecryptable** |
| Future quantum adversary | Archived ciphertext + archived key envelopes | Yes – hybrid ML-KEM + X25519 wrapping, AES-256 data |
| Metadata analyst | Owners, timestamps, sizes, query patterns | Partly – ephemeral signers, padding, blind indexes, batching |
| Malicious verifier | A proof | Yes – learns only the proven statement (ZK) |
| Compromised key custodian (1 of n) | One key share | Yes – threshold t-of-n, one share is useless |
| Someone who decrypted *before* shred | Plaintext | **No** – nobody can. Stated explicitly in UX. |
| Malware on user device | Everything | No – out of scope |

## What we promise users (UX copy)

- "Your data is encrypted on your device before it touches Arkiv."
- "You can prove things about your data without showing it."
- "When you delete, we destroy the only keys. Every copy anywhere, including old servers, becomes unreadable. You get a signed deletion receipt."
- "We cannot undo a delete. Neither can anyone else."

## Why judges / users care

- First **GDPR-compatible erasure story** for a public DB-chain.
- ZK makes encrypted data *useful* (eligibility checks, private attestations) instead of just hidden.
- Library, not app: any Arkiv builder can `npm i arkivzk`.
