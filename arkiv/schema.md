# Arkiv entities used by arkivzk

All entities carry `app = "arkivzk"` (indexed) so anyone can find them. Network: Rabdi, chain 7794095.

| Entity (schema tag) | Who owns it | Indexed (queryable) | Stored (bytes / not indexed) | Expires | Flags |
|---|---|---|---|---|---|
| `arkivzk.record.v1` | the user's wallet (or a one-time signer) | `app`, `schemaId`, `epoch`, `commitment`, optional blind tags `bix0..2` (equality), `r1..r8` (range tree), `rel` (blind foreign key) | `ct` (AES-256-GCM ciphertext, padded), `envId` (sealed record id), `swarmRef` (optional) | the retention the user picks (5 min demo … 182 days), renewable | `readonly`, no permissionless extension |
| `arkivzk.proof.v1` | the user's wallet | `app`, `recordKey`, `circuitId`, `vkHash`, `audience`, `claim` | `statement` (public inputs + label JSON), `proof` (UltraHonk, 14,656 B) | **same block as its record** (never outlives it) | `readonly` |
| `arkivzk.vk.v1` | first prover | `app`, `circuitId`, `vkHash` | `vk` (3,680 B) | max lifetime; anyone may extend | `readonly`, permissionless extension |
| `arkivzk.receipt.v1` | the user's wallet | `app`, `recordKey`, `level` | `shreddedAt` (u64), `request` (controller-signed), `attestations` (guardian-signed) | max lifetime; anyone may extend | `readonly`, permissionless extension |

## Fields we query

| Query | Used by |
|---|---|
| `app = "arkivzk" AND $owner = <wallet>` | vault recovery on a new device, "my records" |
| `app = "arkivzk" AND vkHash = <h>` | every proof verification (VK registry) |
| `app = "arkivzk" AND recordKey = <k>` on receipts | verifier: was this record shredded? |
| `app = "arkivzk" AND audience = sha256(nonce)` | verifier: all proofs answering my challenge |
| `recordKey IN (...)` on proofs | hasMany join, batched in groups of 20 |
| `$key IN (...)` | liveness + expiry of many entities in one query (shred / renew) |
| `schemaId = s AND (bix0 = t OR bix1 = t OR bix2 = t …)` | exact-match search on an encrypted field |
| `schemaId = s AND (r3 = t₁ OR r5 = t₂ OR … ≤ 14 terms per month)` | range search / `count()` on an encrypted field |
| `rel = HMAC(parent)` | JOIN parent → children, cascade shred |

## What is deliberately NOT on Arkiv

Plaintext, keys, key shares, commitment salts, the record id ↔ entity mapping (only sealed as `envId`), attachments (encrypted on Swarm). See [docs/04](../docs/04-crypto-shredding.md).

## One query you can run

```ts
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
const c = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY! }), transport: http() });
const r = await c.select({ $key: true, recordKey: true, level: true }).where(eq("app", "arkivzk")).limit(20).fetch();
console.log(r.entities);
```
