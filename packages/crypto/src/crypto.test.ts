import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aead, pad, unpad, shamir, kemKeygen, hpkeSeal, hpkeOpen, signKeygen, signPayload, verifyPayload,
  fromHex, utf8, fromUtf8, encodeField, BN254_P, randomBytes, equalBytes,
} from "./index.js";

test("aes-gcm roundtrip + aad binding + tamper", () => {
  const k = aead.newKey();
  const ct = aead.seal(k, utf8("hello"), utf8("aad"));
  assert.equal(fromUtf8(aead.open(k, ct, utf8("aad"))), "hello");
  assert.throws(() => aead.open(k, ct, utf8("other")));
  ct[20] ^= 1;
  assert.throws(() => aead.open(k, ct, utf8("aad")));
});

test("padding hides length within bucket", () => {
  assert.equal(pad(utf8("a")).length, 256);
  assert.equal(pad(new Uint8Array(300)).length, 1024);
  assert.equal(fromUtf8(unpad(pad(utf8("xyz")))), "xyz");
});

test("shamir 2-of-3: any two recover, one reveals nothing useful", () => {
  const secret = randomBytes(32);
  const [a, b, c] = shamir.split(secret, 3, 2);
  for (const pair of [[a, b], [a, c], [b, c]]) assert.ok(equalBytes(shamir.combine(pair), secret));
  // a single share combined with a forged one gives garbage
  const forged = new Uint8Array(a.length); forged[0] = 9;
  assert.ok(!equalBytes(shamir.combine([a, forged]), secret));
});

test("shamir 3-of-5", () => {
  const secret = randomBytes(48);
  const s = shamir.split(secret, 5, 3);
  assert.ok(equalBytes(shamir.combine([s[4], s[1], s[2]]), secret));
});

test("hybrid ML-KEM-768 + X25519 hpke", () => {
  const kp = kemKeygen();
  const sealed = hpkeSeal(kp.publicKey, utf8("share"), "ctx");
  assert.equal(fromUtf8(hpkeOpen(kp.secretKey, sealed, "ctx")), "share");
  assert.throws(() => hpkeOpen(kp.secretKey, sealed, "other-ctx"));
  assert.throws(() => hpkeOpen(kemKeygen().secretKey, sealed, "ctx"));
});

test("ed25519 canonical payload signing", () => {
  const kp = signKeygen();
  const sig = signPayload(kp.secretKey, "t", { b: 1, a: [2, 3] });
  assert.ok(verifyPayload(kp.publicKey, "t", { a: [2, 3], b: 1 }, fromHex(sig)));
  assert.ok(!verifyPayload(kp.publicKey, "t", { a: [2, 3], b: 2 }, fromHex(sig)));
  assert.ok(!verifyPayload(kp.publicKey, "other", { a: [2, 3], b: 1 }, fromHex(sig)));
});

test("field encoding", () => {
  assert.equal(encodeField(25), 25n);
  assert.equal(encodeField(true), 1n);
  const s = encodeField("IN");
  assert.ok(s < BN254_P && s > 2n ** 64n);
  assert.equal(s, encodeField("IN"));
  assert.throws(() => encodeField(-1));
});
