import { ml_kem768_x25519 } from "@noble/post-quantum/hybrid.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { open, seal } from "./aead.js";
import { concat, readU32be, u32be, utf8, zeroize } from "./bytes.js";

/**
 * Hybrid post-quantum public-key encryption (HPKE-style):
 *   KEM  = ML-KEM-768 + X25519 (noble `ml_kem768_x25519`, X-Wing style combiner)
 *   KDF  = HKDF-SHA256(sharedSecret, salt = kemCiphertext, info = context)
 *   AEAD = AES-256-GCM
 * Used for every key share that travels between the client and guardians, so nothing a
 * proxy/log captures today can be decrypted by a future quantum computer.
 */
export const kem = ml_kem768_x25519;

export type KemKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

export const kemKeygen = (seed?: Uint8Array): KemKeyPair => kem.keygen(seed);

function deriveKey(ss: Uint8Array, kemCt: Uint8Array, context: string) {
  return hkdf(sha256, ss, kemCt, utf8("arkivzk/hpke/v1/" + context), 32);
}

/** Output: u32(kemCtLen) || kemCt || aead(nonce||ct||tag) */
export function hpkeSeal(recipientPk: Uint8Array, plaintext: Uint8Array, context: string): Uint8Array {
  const { cipherText, sharedSecret } = kem.encapsulate(recipientPk);
  const key = deriveKey(sharedSecret, cipherText, context);
  const body = seal(key, plaintext, utf8(context));
  zeroize(sharedSecret, key);
  return concat(u32be(cipherText.length), cipherText, body);
}

export function hpkeOpen(secretKey: Uint8Array, sealed: Uint8Array, context: string): Uint8Array {
  const n = readU32be(sealed, 0);
  const kemCt = sealed.subarray(4, 4 + n);
  const ss = kem.decapsulate(kemCt, secretKey);
  const key = deriveKey(ss, kemCt, context);
  try {
    return open(key, sealed.subarray(4 + n), utf8(context));
  } finally {
    zeroize(ss, key);
  }
}
