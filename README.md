# arkivzk

> Private-by-default data on a public-by-default database.
> **ZK end-to-end** + **god-level crypto-shredding** for [Arkiv](https://docs.arkiv.network).

Arkiv stores everything in public: attributes, owner, creator, expiry, and the full transaction
history (calldata). `deleteEntity` only removes an entity from *current state*. Any node runner
or archive indexer that synced the old blocks still holds the bytes forever.

**arkivzk** fixes both problems from the client side, without changing Arkiv:

| Problem | arkivzk answer |
|---|---|
| Data is public | Plaintext never leaves the user's device. Only ciphertext + commitments go on-chain. |
| Need to *use* private data | ZK proofs over committed data: prove a fact (age > 18, balance in range, member of group, record unchanged) without revealing it. |
| Writer is public (`$owner`, tx sender) | Ephemeral signer per write + optional ZK membership proof ("someone in group G wrote this"). |
| Delete is not real delete | **Crypto-shredding**: destroy the key, not the data. Old ciphertext on every old node becomes random noise. |
| "Harvest now, decrypt later" | Hybrid post-quantum key wrapping (ML-KEM-768 + X25519), so archived ciphertext stays safe even later. |

## Read in this order

1. [docs/01-idea.md](docs/01-idea.md) – the pitch, threat model, what we promise and what we don't
2. [docs/02-architecture.md](docs/02-architecture.md) – library layout + all mermaid diagrams
3. [docs/03-zk.md](docs/03-zk.md) – ZK end-to-end design (circuits, commitments, proofs on Arkiv)
4. [docs/04-crypto-shredding.md](docs/04-crypto-shredding.md) – the deletion design, key hierarchy, shred receipts
5. [docs/05-mvp-plan.md](docs/05-mvp-plan.md) – what we build first given limited time
6. [diagrams/](diagrams/) – standalone `.mmd` files (paste into mermaid.live)

## One-line API (target)

```ts
const zk = await ArkivZK.create({ arkiv: walletClient, vault })

const { entityKey } = await zk.put(MedicalRecord, record, { prove: ["age>=18"] })
const proof          = await zk.prove(entityKey, "age>=18")       // share with a verifier
const ok             = await ArkivZK.verify(entityKey, proof)      // anyone, no key needed
const receipt        = await zk.shred(entityKey)                   // gone for everyone, forever
```
