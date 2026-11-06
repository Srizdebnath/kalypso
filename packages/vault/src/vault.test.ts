// Integration test against two REAL guardian processes (started by this test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { shamir, aead, randomBytes, toHex, equalBytes } from "@arkivzk/crypto";
import { Vault, MemoryKV, rawKeySealer, GuardianClient, buildShredRequest, verifyDestroyedAttestation, verifyShredRequest } from "./index.js";

const server = path.resolve(import.meta.dirname, "../../../guardian/dist/server.js");
const procs: ChildProcess[] = [];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arkivzk-g-"));

async function startGuardian(name: string, port: number) {
  const p = spawn(process.execPath, [server], { env: { ...process.env, GUARDIAN_NAME: name, PORT: String(port), GUARDIAN_DATA_DIR: path.join(dataDir, name) }, stdio: "pipe" });
  procs.push(p);
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/info`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("guardian did not start");
}

before(async () => { await startGuardian("gt-1", 17101); await startGuardian("gt-2", 17102); });
after(() => { procs.forEach((p) => p.kill()); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("2-of-3 key custody, fetch, shred with attestations, nothing recoverable after", async () => {
  const vault = await Vault.open(new MemoryKV(), rawKeySealer(aead.newKey()));
  const g = [new GuardianClient("http://127.0.0.1:17101"), new GuardianClient("http://127.0.0.1:17102")];
  const dek = randomBytes(32);
  const [device, s1, s2] = shamir.split(dek, 3, 2);
  const recordId = toHex(randomBytes(16));
  const exp = Date.now() + 3600_000;
  await g[0].putShare(vault, recordId, s1, exp);
  await g[1].putShare(vault, recordId, s2, exp);

  // recovery without the device share (device lost): two guardians suffice
  const r1 = await g[0].fetchShare(vault, recordId);
  const r2 = await g[1].fetchShare(vault, recordId);
  assert.ok(equalBytes(shamir.combine([r1, r2]), dek));
  assert.ok(equalBytes(shamir.combine([device, r2]), dek));

  // a different controller can't fetch or shred
  const mallory = await Vault.open(new MemoryKV(), rawKeySealer(aead.newKey()));
  await assert.rejects(g[0].fetchShare(mallory, recordId), /signature/);
  await assert.rejects(g[0].shred(buildShredRequest(mallory, [recordId], "user")), /not controller/);

  // shred
  const req = buildShredRequest(vault, [recordId], "user");
  assert.ok(verifyShredRequest(req));
  const atts = await Promise.all(g.map((x) => x.shred(req)));
  for (const a of atts) {
    assert.ok(verifyDestroyedAttestation(a, req));
    assert.deepEqual(a.results, [{ recordId, status: "destroyed" }]);
  }
  // tampered attestation fails verification
  assert.ok(!verifyDestroyedAttestation({ ...atts[0], ts: atts[0].ts + 1 }, req));
  // replay of the same shred request is rejected
  await assert.rejects(g[0].shred(req), /replayed/);
  // shares are gone
  await assert.rejects(g[0].fetchShare(vault, recordId), /no share/);
  await assert.rejects(g[1].fetchShare(vault, recordId), /no share/);
});

test("recovery kit restores the controller identity", async () => {
  const v1 = await Vault.open(new MemoryKV(), rawKeySealer(aead.newKey()));
  const kit = v1.exportRecoveryKit("correct horse battery staple");
  const v2 = await Vault.importRecoveryKit(new MemoryKV(), rawKeySealer(aead.newKey()), kit, "correct horse battery staple");
  assert.equal(v2.controller, v1.controller);
  const id = toHex(randomBytes(16));
  assert.equal(v2.openEnvId(v1.sealEnvId(id)), id);
  await assert.rejects(Vault.importRecoveryKit(new MemoryKV(), rawKeySealer(aead.newKey()), kit, "wrong passphrase!!"), /wrong passphrase/);
});
