// Runnable query: list live arkivzk shred receipts on Arkiv Rabdi and check each one.
// Usage (after `pnpm build`):  ARKIV_ACCESS_KEY=... node packages/sdk/query-receipts.mjs
// Read-only: no wallet, no private key.
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { ShredReceipt, APP } from "@arkivzk/core";
import { getReceipt } from "./dist/index.js";

const pc = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http() });
const res = await pc
  .select({ $key: true, $owner: true, $expiresAt: true, recordKey: true, level: true, shreddedAt: true })
  .from(ShredReceipt)
  .where(eq("app", APP))
  .limit(10)
  .fetch();
console.log(`${res.entities.length} receipt(s)`);
for (const e of res.entities) {
  const r = await getReceipt(pc, e.$key);
  console.log(e.$key, e.level.value, new Date(Number(e.shreddedAt.value)).toISOString(),
    "controllerSig", r.requestValid, "guardianSigs", r.attestations.map((a) => a.valid), "recordLive", r.recordStillLive);
}
