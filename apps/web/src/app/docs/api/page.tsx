import type { Metadata } from "next";
import { Markdown } from "@/components/markdown";

export const metadata: Metadata = { title: "Client API" };

const API_MD = `
# Client API

Every screen of the web app talks to the Kalypso SDK through **one browser-side module**:
\`apps/web/src/lib/arkivzk-client.ts\`. The UI imports nothing else from the library, so this file
is the whole contract between the frontend and \`@arkivzk/sdk\` / the app's API routes.

All functions are \`async\`, run in the browser, and **throw on failure**. The UI shows the
error's \`message\` to the user as-is, so messages should be human readable.

\`\`\`mermaid
flowchart LR
    subgraph UI["Next.js UI (use client)"]
        V[Vault]
        P[Prove]
        S[Shred]
        VF["/verify/[proofKey]"]
        R["/receipt/[key]"]
        AR["/archive"]
    end
    C["arkivzk-client.ts"]
    SDK["@arkivzk/sdk<br/>encrypt, commit, prove, shred"]
    API["/api/* routes<br/>Arkiv RPC, guardians, archive"]
    V --> C
    P --> C
    S --> C
    VF --> C
    R --> C
    AR --> C
    C --> SDK
    C --> API
\`\`\`

## Types

\`\`\`ts
type FieldValue   = number | string | boolean
type RecordStatus = "live" | "shredded" | "expired"

type LocalRecord = {
  entityKey: \`0x\${string}\`
  schemaId: string
  createdAt: number            // ms or s since epoch
  expiresAtBlock: string
  expiresAtMs: number | null   // null when the expiry time can't be estimated
  status: RecordStatus
  swarmRef?: string            // encrypted attachment on Swarm
  fieldNames: string[]         // fields usable in proofs
  pendingShred?: boolean       // keys destroyed, receipt not yet published
}

type PutInput  = { schemaId: string; values: Record<string, FieldValue>; file?: File; retentionSeconds: number }
type PutResult = { entityKey: \`0x\${string}\`; txHash: \`0x\${string}\`; expiresAtBlock: string; commitment: string; swarmRef?: string }

type DecryptedRecord = {
  values: Record<string, FieldValue>
  file?: { name: string; type: string; bytes: Uint8Array }
}

type Claim       = { field: string; min?: number; max?: number; equals?: FieldValue }
type ProveResult = { proofEntityKey: \`0x\${string}\`; txHash: \`0x\${string}\`; statementText: string; proveMs: number }

type ShredStep = { id: string; label: string; status: "pending" | "running" | "done" | "error"; detail?: string }

type ShredReceiptView = {
  receiptKey: \`0x\${string}\`
  txHash: \`0x\${string}\`
  level: string
  deletedEntities: string[]
  attestations: { guardian: string; publicKey: string; signature: string; valid: boolean }[]
  createdAt: number
  keySharesRemainingAtMost: number
}

type VerifyResult = {
  valid: boolean
  statementText: string
  recordKey: string
  recordStatus: RecordStatus
  vkHash: string
  reason?: string
  checks: { name: string; ok: boolean; detail?: string }[]
  receiptKey?: string          // set when the record was shredded
}

type ArchiveItem    = { txHash: string; blockNumber: string; capturedAt: number; bytes: number; entityKeys: string[]; recordShredded: boolean }
type DecryptAttempt = { success: boolean; log: string[] }

type QueryPreset =
  | { kind: "myRecords" }
  | { kind: "proofsForMyRecords" }
  | { kind: "addressedTo"; nonce: string; claim?: string }
\`\`\`

## Wallet

| Function | Returns | Notes |
|---|---|---|
| \`connectWallet()\` | \`{ address }\` | Prompts the injected wallet. Called by the **Connect wallet** button. |
| \`currentAccount()\` | \`address \\| null\` | Must **not** prompt. Called on load of \`/app\` to restore a session. |

## Vault (needs wallet)

| Function | Used by | Notes |
|---|---|---|
| \`putRecord(input, onStep?)\` | Vault → create | Encrypts on device, commits, splits the key 2-of-3, uploads the optional file to Swarm, writes the record entity. \`onStep(s)\` is called with short human strings; the UI shows them as a live log. |
| \`listRecords()\` | Vault, Prove, Shred | Records known to this device. The UI shows status badges and "expires in X" from \`expiresAtMs\`. |
| \`getRecord(entityKey)\` | Vault → view | Reassembles the key and decrypts. If \`file\` is present the UI offers a download (and an inline preview for images). |

The Vault form sends \`schemaId: "medical.v1"\` with \`values = { age: number, country: string, bloodGroup: string }\`
and \`retentionSeconds\` of 300 (5 minute demo), 1, 7, 30 or 180 days.

## Lease / renew (needs wallet)

| Function | Used by | Notes |
|---|---|---|
| \`renewRecords(entityKeys, seconds, onStep?)\` | Vault → Renew (single or bulk) | Extends all selected records in **one** Arkiv transaction. Durations offered: +1, +7, +30, +180 days. Resolves \`{ txHash, extended }\`. |
| \`expiringSoon(withinDays)\` | Vault banner | Called with \`7\`; drives "N records expire within 7 days". |
| \`reminderIcsUrl(entityKey, daysBefore)\` | Vault → 📅 Reminder | Returns an object URL to a \`.ics\` file; the UI downloads it. Called with \`daysBefore = 1\`. |

## Recovery (needs wallet)

| Function | Notes |
|---|---|
| \`exportRecoveryKit(passphrase)\` | UI enforces ≥ 12 characters and a repeat field, then downloads the returned JSON string. |
| \`restoreFromKit(kitJson, passphrase, onStep?)\` | UI reads the uploaded file as text. Resolves with recovered entity keys, which are listed. |

## Query explorer (needs wallet)

| Function | Notes |
|---|---|
| \`explainQuery(preset)\` | Called whenever the preset changes; the text is shown as-is in a monospace block. |
| \`runQuery(preset)\` | Rows are rendered as a table (columns = union of row keys). \`queries\` is shown as "queries used". |

## Prove (needs wallet)

| Function | Notes |
|---|---|
| \`proveClaim(entityKey, claim, verifierNonce, onStep?)\` | Generates the proof (takes seconds; the UI shows a live timer plus \`onStep\` messages) and publishes a proof entity. The UI builds the share link \`/verify/<proofEntityKey>\`. |

Claims sent by the UI:

- range: \`{ field, min?, max? }\` (at least one bound, numbers only)
- equality: \`{ field, equals }\` (number if the input parses as a number, otherwise string)

## Shred (needs wallet)

| Function | Notes |
|---|---|
| \`retryShredPublish(entityKeys, onStep)\` | For records with \`pendingShred\`: keys are gone, but the delete + receipt didn't publish. Same \`onStep\` semantics as \`shredRecords\`. |
| \`shredRecords(entityKeys, onStep)\` | \`onStep\` receives the **full** current step list each time (not a delta); the UI re-renders it as-is. Suggested steps: guardian 1 destroyed, guardian 2 destroyed, device share destroyed, Arkiv delete tx, receipt entity. Resolves with the receipt; the UI links \`/receipt/<receiptKey>\` and offers the receipt as a JSON erasure certificate download. |

## Public (no wallet)

| Function | Page | Notes |
|---|---|---|
| \`verifyProof(proofEntityKey)\` | \`/verify/[proofKey]\` | Reads the proof + record commitment from Arkiv and verifies. \`checks\` renders as a pass/fail checklist. \`recordStatus === "shredded"\` is shown as revoked even if the math checks out, with a link to \`receiptKey\`. |
| \`getReceipt(receiptKey)\` | \`/receipt/[key]\` | Reads a ShredReceipt and checks each guardian signature (\`valid\`). Shows \`keySharesRemainingAtMost\`. |
| \`erasureCertificate(receiptKey)\` | receipt card | Downloaded as JSON by "Download erasure certificate". |
| \`listArchive()\` | \`/archive\` | Raw calldata snapshots captured by the archive indexer. |
| \`tryDecryptArchived(txHash)\` | \`/archive\` | Tries to decrypt a snapshot with everything an archive node has. \`log\` lines are printed in a terminal view. |

## Pages and routes

| Route | Wallet | What it does |
|---|---|---|
| \`/app\` | yes | Vault: create records, list, decrypt |
| \`/app/prove\` | yes | Generate a proof + share link |
| \`/app/shred\` | yes | Shred records, retry pending receipts, get receipt |
| \`/app/query\` | yes | Query explorer: EXPLAIN plan + results |
| \`/app/settings\` | yes | Recovery kit export / restore |
| \`/verify/[proofKey]\` | no | Verify a proof |
| \`/receipt/[key]\` | no | Inspect a shred receipt |
| \`/archive\` | no | Old node runner view |

## Cross-origin isolation

The site is served with \`Cross-Origin-Opener-Policy: same-origin\` and
\`Cross-Origin-Embedder-Policy: require-corp\` so the multithreaded WASM prover can use
\`SharedArrayBuffer\`. Any cross-origin resource the client loads (WASM, workers, scripts) must be
same-origin or send \`Cross-Origin-Resource-Policy\` / CORS headers.
`;

export default function ApiDocsPage() {
  return (
    <article className="min-w-0 max-w-3xl">
      <p className="mb-8 text-[0.8rem] text-[#8a8a8a]">Docs / Client API · apps/web/src/lib/arkivzk-client.ts</p>
      <Markdown source={API_MD} />
    </article>
  );
}
