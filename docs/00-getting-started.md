# 00 · Getting started

This guide takes you from a fresh clone to a working vault on Arkiv's Rabdi testnet in about ten minutes. It covers running everything locally, a tour of the app, using the SDK from your own code, and fixes for the errors you are most likely to hit.

> **What Kalypso is, in one line:** a TypeScript library that encrypts your data on your device, stores only ciphertext and commitments on Arkiv, lets you prove facts about it in zero knowledge, and erases it for good by destroying the keys.

## What you need

| Thing | Why | Where to get it |
|---|---|---|
| Node.js 22+ and pnpm 9+ | builds the packages and the web app | nodejs.org, `npm i -g pnpm` |
| An Arkiv access key | reads from the Rabdi RPC (10 quota units per query) | [Hub → access keys](https://hub.arkiv.network/access-keys) |
| A browser wallet on Rabdi, with test ETH | signs your writes | [Hub → faucet](https://hub.arkiv.network/faucet) |
| A relayer key with test ETH (optional) | pays gas for one-time signers in "unlinkable" mode | any funded Rabdi account you control |
| Docker (optional) | a local Swarm cluster for encrypted attachments | docker.com |

You do **not** need Noir or Barretenberg installed. The compiled circuits ship inside `@arkivzk/zk`. Run `pnpm circuits` only if you change a circuit.

## 1. Install and build

```bash
git clone <this repo> arkivzk && cd arkivzk
pnpm install
pnpm build          # crypto, zk, core, vault, shred, sdk
pnpm test           # unit tests: crypto, zk proof round-trip, range cover, vault
```

## 2. Configure

Create `apps/web/.env.local`. This file is gitignored. Never commit it.

```bash
ARKIV_ACCESS_KEY=<your Hub access key>        # server-side only, used by /api/rpc
RELAYER_PRIVATE_KEY=<funded Rabdi key>        # optional: enables one-time signers
GUARDIAN_URLS=http://127.0.0.1:7101,http://127.0.0.1:7102   # default, can be omitted
ARCHIVE_URL=http://127.0.0.1:7301             # default, can be omitted
BEE_URL=http://127.0.0.1:1633                 # optional: Swarm attachments
SWARM_POSTAGE_BATCH_ID=<batch id>             # optional: Swarm attachments
```

The browser never sees the access key or the relayer key. Reads go through the app's `/api/rpc` proxy, and writes are signed by your wallet.

## 3. Start the services

Use one terminal per service.

```bash
# two guardians: each holds one of the three key shares
cd guardian && pnpm build && pnpm start:g1
cd guardian && pnpm start:g2

# archive node: records raw calldata so you can try to break a shred later
cd archive && pnpm build && set -a && . ../apps/web/.env.local && set +a && pnpm start

# the web app
cd apps/web && pnpm build && pnpm start      # http://localhost:3000
```

**Optional: Swarm attachments.** This needs Docker.

```bash
npx @fairdatasociety/fdp-play start --fresh --detach   # local Bee cluster on :1633
curl -s -X POST localhost:1633/stamps/100000000/20    # copy the batchID into .env.local
```

## 4. A five-minute tour of the app

| Step | Where | What happens |
|---|---|---|
| 1. Connect | `/app` | Your wallet connects. The app creates a device key in IndexedDB and opens your local vault. |
| 2. Store | Vault tab | Fill in the form and press **Encrypt & store**. The record is encrypted in the tab, its key is split 2-of-3, and one Arkiv transaction writes the ciphertext and the commitment. |
| 3. Search | Vault tab → search box | Exact match, range (e.g. age 18–40) or **Count**. Arkiv filters HMAC tags. It never sees values. |
| 4. Prove | Prove tab | Pick a claim such as `age ≥ 18`. A Noir proof is generated in the browser and published. You get a link anyone can open. |
| 5. Verify | `/verify/<key>` | No wallet and no key. The page runs nine checks, including the proof, the commitment and whether the record was shredded. |
| 6. Shred | Shred tab | The guardians and your device destroy their shares and sign. One transaction deletes the entities and writes a public receipt. |
| 7. Break it | `/archive` | The archive node replays the calldata it captured and tries to decrypt it. It can't. |

## 5. Use the SDK in your own code

```ts
import { ArkivZK, Vault, MemoryKV, rawKeySealer, GuardianClient, verifyProofEntity } from "@arkivzk/sdk";

const zk = new ArkivZK({
  publicClient,                                     // createPublicClient({ chain: rabdi({ accessKey }), transport: http() })
  vault: await Vault.open(new MemoryKV(), rawKeySealer(deviceKey)),
  guardians: [new GuardianClient("http://127.0.0.1:7101"), new GuardianClient("http://127.0.0.1:7102")],
  write: { chain, rpc, publicClient, provider, account },
});

// store: encrypted on device, searchable by range, kept for 7 days
const { entityKey } = await zk.put({
  schemaId: "medical.v1",
  values: { age: 25, country: "IN" },
  rangeField: "age",
  retentionSeconds: 7 * 24 * 3600,
});

// prove: publish a zero-knowledge claim for one verifier
const { proofEntityKey } = await zk.prove(entityKey, { field: "age", min: 18 }, "pharmacy-42");

// verify: anyone, no keys
const result = await verifyProofEntity(publicClient, proofEntityKey);

// query: Arkiv evaluates tags, never values
const adults = await zk.searchRange("medical.v1", "age", 18, 40);
const total  = await zk.count("medical.v1", "age", { min: 18, max: 40 });   // or { eq: "IN" } on a searchable field

// shred: destroy keys for the record and its children, publish a receipt
await zk.shred([entityKey], () => {}, { cascade: true });
```

Every method, with options and return types, is in [06 · SDK reference](06-sdk-reference.md). Relational features (multi-insert, parents, JOIN, cascade) are in [§8f](06-sdk-reference.md#8f-relational-layer-atomic-inserts-1n-mn-cascade).

## 6. Check it against the live chain

Each script writes real transactions on Rabdi and fails loudly if a result doesn't match. They need `DEV_PRIVATE_KEY` (a funded Rabdi key) and `ARKIV_ACCESS_KEY` in the repo-root `.env`.

| Script | Checks |
|---|---|
| `node packages/sdk/e2e.mjs` | 12 steps: put, get, prove, verify, search, renew, shred, receipt, archive |
| `node packages/sdk/query-encrypted.mjs` | encrypted range, COUNT and JOIN against decrypt-everything |
| `node packages/sdk/relational.mjs` | atomic insert, 1:N, M:N, N+1, orphans, cascade, recovery |
| `node packages/sdk/query-live.mjs` | planner: IN-batching, keyset paging, projection |
| `node packages/sdk/query-receipts.mjs` | read-only: lists shred receipts and verifies signatures |

## 7. Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| "This browser's vault can't be unlocked with its device key" | the browser's device key changed (cleared site data, another profile) | Settings → restore from your recovery kit |
| `MissingAccessKeyError` or HTTP 429 | no or empty `ARKIV_ACCESS_KEY` on the server | set it in `apps/web/.env.local` and restart |
| "ephemeral signer mode needs a relayer" | `RELAYER_PRIVATE_KEY` missing or unfunded | set and fund it, or sign with your own wallet |
| Attachment upload returns 503 | Swarm not configured | set `BEE_URL` and `SWARM_POSTAGE_BATCH_ID`, or skip attachments |
| Guardian unreachable | a guardian process isn't running | start both guardians. Reads need any 2 of the 3 shares |
| First proof is slow | the WASM prover loads once per tab | later proofs in the same tab take well under a second |
| A shred stopped after destroying keys | the Arkiv transaction failed | open Shred again. It retries only the on-chain part (`publishShredReceipts`) |

## Where to go next

- [01 · Idea, threat model, promises](01-idea.md): what we protect against and what we don't
- [04 · Crypto-shredding](04-crypto-shredding.md): the deletion design and key hierarchy
- [07 · Performance](07-performance.md): complexity and live measurements
- [08 · Design FAQ](08-design-faq.md): why this is built on top of Arkiv, and the questions judges ask
