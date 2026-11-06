// Local micro-benchmarks for docs/07-performance.md (no chain needed).
import { aead, pad, shamir, kemKeygen, hpkeSeal, hpkeOpen, signKeygen, signPayload, verifyPayload, fromHex, randomBytes, encodeField, randomFieldSalt } from "@arkivzk/crypto";
import { computeCommitment, proveRange, verifyRange, rangeVerificationKey, barretenberg, shutdown } from "@arkivzk/zk";
import { scrypt } from "@noble/hashes/scrypt.js";
import fs from "node:fs";
import os from "node:os";

const out = { machine: `${os.cpus()[0].model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB, Node ${process.version}`, at: new Date().toISOString(), results: {} };
function bench(name, fn, iters = 200) {
  for (let i = 0; i < Math.min(10, iters); i++) fn();
  const s = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = (performance.now() - s) / iters;
  out.results[name] = +ms.toFixed(4);
  console.log(name.padEnd(44), ms.toFixed(4), "ms");
}
async function benchA(name, fn, iters = 5) {
  await fn();
  const s = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const ms = (performance.now() - s) / iters;
  out.results[name] = +ms.toFixed(1);
  console.log(name.padEnd(44), ms.toFixed(1), "ms");
}

const k = aead.newKey();
for (const n of [256, 4096, 65536]) { const d = randomBytes(n); bench(`aes-256-gcm seal ${n} B`, () => aead.seal(k, d)); }
bench("pad 100 B record -> bucket", () => pad(randomBytes(100)));
const dek = randomBytes(32);
bench("shamir split 32 B, 2-of-3", () => shamir.split(dek, 3, 2));
const sh = shamir.split(dek, 3, 2);
bench("shamir combine 2 shares", () => shamir.combine([sh[0], sh[2]]));
const kp = kemKeygen();
bench("ml-kem768+x25519 keygen", () => kemKeygen(), 50);
const sealed = hpkeSeal(kp.publicKey, sh[1], "c");
bench("hpke seal (share)", () => hpkeSeal(kp.publicKey, sh[1], "c"), 100);
bench("hpke open (share)", () => hpkeOpen(kp.secretKey, sealed, "c"), 100);
out.results["hpke sealed share bytes"] = sealed.length;
const sk = signKeygen();
const sig = signPayload(sk.secretKey, "d", { a: 1 });
bench("ed25519 sign", () => signPayload(sk.secretKey, "d", { a: 1 }), 100);
bench("ed25519 verify", () => verifyPayload(sk.publicKey, "d", { a: 1 }, fromHex(sig)), 100);
const t = performance.now(); scrypt("correct horse battery", randomBytes(16), { N: 2 ** 17, r: 8, p: 1, dkLen: 32 });
out.results["scrypt N=2^17 (recovery kit)"] = Math.round(performance.now() - t); console.log("scrypt N=2^17".padEnd(44), out.results["scrypt N=2^17 (recovery kit)"], "ms");

const fields = [25n, encodeField("IN"), encodeField("O+"), 0n, 0n, 0n, 0n, 0n];
const salt = randomFieldSalt();
let C;
await benchA("poseidon2 commitment (noir execute)", async () => { C = await computeCommitment(fields, salt); }, 10);
const st = { commitment: C, slot: 0, min: 18n, max: (1n << 64n) - 1n, context: 1n };
let p;
await benchA("prove range (UltraHonk, WASM)", async () => { p = await proveRange(fields, salt, st); }, 5);
const vk = await rangeVerificationKey();
await benchA("verify range", async () => { await verifyRange(p.proof, st, vk); }, 10);
const rangeJson = JSON.parse(fs.readFileSync("../../circuits/range/target/arkivzk_range.json", "utf8"));
const api = await barretenberg();
const [gates] = await api.acirGetCircuitSizes(Buffer.from(rangeJson.bytecode, "base64"), false, true).catch(() => [null]);
Object.assign(out.results, { "proof bytes": p.proof.length, "vk bytes": vk.length, "range circuit gates": gates });
console.log("proof bytes", p.proof.length, "vk bytes", vk.length, "gates", gates);
fs.writeFileSync("../../docs/bench.json", JSON.stringify(out, null, 2));
await shutdown();
