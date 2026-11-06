import { test, after } from "node:test";
import assert from "node:assert/strict";
import { encodeField, randomFieldSalt } from "@arkivzk/crypto";
import { computeCommitment, proveRange, verifyRange, rangeVerificationKey, shutdown, statementOf } from "./index.js";

after(() => shutdown());

test("commit -> prove age>=18 -> verify; tamper fails", { timeout: 120_000 }, async () => {
  const fields = [25, encodeField("IN"), 0, 0, 0, 0, 0, 0].map((x) => BigInt(x));
  const salt = randomFieldSalt();
  const commitment = await computeCommitment(fields, salt);
  const st = { commitment, slot: 0, min: 18n, max: 200n, context: 42n };
  const p = await proveRange(fields, salt, st);
  const vk = await rangeVerificationKey();
  assert.deepEqual(statementOf(p.publicInputs), st);
  assert.equal(await verifyRange(p.proof, st, vk), true);
  assert.equal(await verifyRange(p.proof, { ...st, min: 19n }, vk), false);
  assert.equal(await verifyRange(p.proof, { ...st, context: 43n }, vk), false);
  assert.equal(await verifyRange(p.proof, { ...st, commitment: commitment + 1n }, vk), false);
});

test("cannot prove a false statement", { timeout: 120_000 }, async () => {
  const fields = [16n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
  const salt = randomFieldSalt();
  const commitment = await computeCommitment(fields, salt);
  await assert.rejects(proveRange(fields, salt, { commitment, slot: 0, min: 18n, max: 200n, context: 0n }));
});

test("string equality proof", { timeout: 120_000 }, async () => {
  const country = encodeField("IN");
  const fields = [25n, country, 0n, 0n, 0n, 0n, 0n, 0n];
  const salt = randomFieldSalt();
  const commitment = await computeCommitment(fields, salt);
  const st = { commitment, slot: 1, min: country, max: country, context: 7n };
  const p = await proveRange(fields, salt, st);
  assert.equal(await verifyRange(p.proof, st, await rangeVerificationKey()), true);
});
