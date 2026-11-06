// Live end-to-end run on Arkiv Rabdi with real guardians. Usage (repo root .env + apps/web/.env.local):
//   node packages/sdk/e2e.mjs
// Prints timings used in docs/07-performance.md.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createWalletClient as viemWallet, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ArkivZK, Vault, MemoryKV, rawKeySealer, GuardianClient, verifyProofEntity, getReceipt, erasureCertificate,
  LeaseManager, QueryPlanner, ZkRecord,
} from "./dist/index.js";
import { aead, fromHex } from "@arkivzk/crypto";
import { shutdown } from "@arkivzk/zk";

const root = path.resolve(import.meta.dirname, "../..");
const env = Object.fromEntries(
  [".env", "apps/web/.env.local"].flatMap((f) => fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8").split("\n") : [])
    .filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const chain = rabdi({ accessKey: env.ARKIV_ACCESS_KEY });
const transport = http(undefined, { retryCount: 1, timeout: 20000 });
const publicClient = createPublicClient({ chain, transport, cacheTime: 0 });
const account = privateKeyToAccount(env.DEV_PRIVATE_KEY);
const signer = viemWallet({ chain, transport, account });
const rpc = (args) => publicClient.request(args);

// EIP-1193 provider backed by a local key: signs eth_sendTransaction locally, forwards the rest.
const provider = {
  async request({ method, params }) {
    if (method === "eth_sendTransaction") {
      const tx = params[0];
      return signer.sendTransaction({
        to: tx.to, data: tx.data, gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice),
        nonce: tx.nonce !== undefined ? Number(BigInt(tx.nonce)) : undefined, value: tx.value ? BigInt(tx.value) : 0n,
      });
    }
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [account.address];
    return rpc({ method, params });
  },
};

const t = {};
async function timed(name, fn) {
  const s = performance.now();
  try { return await fn(); } finally { t[name] = Math.round(performance.now() - s); console.log(`  ${name}: ${t[name]} ms`); }
}

// --- guardians (real processes) ---
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arkivzk-e2e-"));
const procs = [];
for (const [name, port] of [["e2e-guardian-1", 17201], ["e2e-guardian-2", 17202]]) {
  procs.push(spawn(process.execPath, [path.join(root, "guardian/dist/server.js")], {
    env: { ...process.env, GUARDIAN_NAME: name, PORT: String(port), GUARDIAN_DATA_DIR: path.join(dataDir, name) }, stdio: "inherit",
  }));
}
await new Promise((r) => setTimeout(r, 800));
const cleanup = () => { procs.forEach((p) => p.kill()); fs.rmSync(dataDir, { recursive: true, force: true }); };

try {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`signer ${account.address} balance ${balance} wei`);
  if (balance === 0n) throw new Error("fund the dev address from https://hub.arkiv.network/faucet first");

  const vault = await Vault.open(new MemoryKV(), rawKeySealer(aead.newKey()));
  const zk = new ArkivZK({
    publicClient, vault,
    guardians: [new GuardianClient("http://127.0.0.1:17201"), new GuardianClient("http://127.0.0.1:17202")],
    write: { chain, rpc, publicClient, provider, account: account.address },
  });

  console.log("1. put");
  const put = await timed("put (commit + encrypt + guardians + Arkiv tx)", () =>
    zk.put({ schemaId: "medical.v1", values: { age: 25, country: "IN", bloodGroup: "O+" }, retentionSeconds: 600 }, (s) => console.log("   ·", s)));
  console.log("   entity", put.entityKey, "tx", put.txHash);

  const captured = await publicClient.getEntity(put.entityKey, ZkRecord); // what an archive node keeps forever
  const ctBytes = fromHex(captured.ct.value), envBytes = fromHex(captured.envId.value);
  console.log(`   on-chain ciphertext ${ctBytes.length} bytes (padded bucket)`);

  console.log("2. get");
  const got = await timed("get (2 shares + decrypt)", () => zk.get(put.entityKey));
  console.log("   decrypted", got.record.values);

  console.log("3. prove age>=18");
  const proof = await timed("prove + publish", () => zk.prove(put.entityKey, { field: "age", min: 18 }, "pharmacy-42", (s) => console.log("   ·", s)));
  console.log("   proof entity", proof.proofEntityKey, "prove", proof.proveMs, "ms");

  console.log("4. verify (public)");
  const v = await timed("verify (public, no keys)", () => verifyProofEntity(publicClient, proof.proofEntityKey));
  console.log("   valid:", v.valid, v.statementText); v.checks.forEach((c) => console.log(`     ${c.ok ? "✓" : "✗"} ${c.name}`));

  console.log("5. query planner");
  const qp = new QueryPlanner(publicClient);
  console.log(qp.explain({ from: ZkRecord, where: { app: "arkivzk", schemaId: "medical.v1" }, ownedBy: account.address }));
  const addressed = await timed("query proofsAddressedTo", () => qp.proofsAddressedTo("pharmacy-42"));
  console.log("   proofs addressed to pharmacy-42:", addressed.rows.length, "queries:", addressed.queries);

  console.log("6. renew lease +1 day (record + proof, one tx)");
  const ren = await timed("renew", () => new LeaseManager(zk).renew([put.entityKey], 86400, (s) => console.log("   ·", s)));
  console.log("   extended", ren.extended, "entities in tx", ren.txHash);

  console.log("7. archive capture decrypt BEFORE shred");
  console.log("  ", (await zk.tryDecryptCaptured(ctBytes, envBytes, "medical.v1")).log.join("\n    "));

  console.log("8. shred");
  const sh = await timed("shred (guardians + one Arkiv tx)", () => zk.shred([put.entityKey], (id, st, d) => console.log(`   · ${id} ${st} ${d ?? ""}`)));
  console.log("   receipt", sh.receipts[0], "deleted", sh.deleted.length);

  console.log("9. archive capture decrypt AFTER shred");
  const after = await zk.tryDecryptCaptured(ctBytes, envBytes, "medical.v1");
  console.log("   success:", after.success, "\n    " + after.log.join("\n    "));

  console.log("10. verify old proof again");
  const v2 = await verifyProofEntity(publicClient, proof.proofEntityKey);
  console.log("   valid:", v2.valid, "-", v2.reason);

  console.log("11. receipt");
  const rc = await getReceipt(publicClient, sh.receipts[0]);
  console.log("   controller sig valid:", rc.requestValid, "guardian attestations valid:", rc.attestations.map((a) => a.valid), "record live:", rc.recordStillLive);
  console.log("   certificate:", erasureCertificate(rc, sh.txHash).statement);

  fs.writeFileSync(path.join(root, "docs/e2e-timings.json"), JSON.stringify({ at: new Date().toISOString(), ctBytes: ctBytes.length, proofBytes: null, timings: t, entity: put.entityKey, proofEntity: proof.proofEntityKey, receipt: sh.receipts[0], signer: account.address }, null, 2));
  console.log("\nALL STEPS PASSED");
} catch (e) {
  console.error("E2E FAILED:", e.message);
  process.exitCode = 1;
} finally {
  cleanup();
  await shutdown();
}
