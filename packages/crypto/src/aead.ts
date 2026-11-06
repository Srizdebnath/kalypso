import { gcm } from "@noble/ciphers/aes.js";
import { concat, randomBytes } from "./bytes.js";

export const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/** AES-256-GCM. Output = nonce(12) || ciphertext+tag. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new Error("AES-256 key must be 32 bytes");
  const nonce = randomBytes(NONCE_BYTES);
  return concat(nonce, gcm(key, nonce, aad).encrypt(plaintext));
}

export function open(key: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new Error("AES-256 key must be 32 bytes");
  if (sealed.length < NONCE_BYTES + 16) throw new Error("ciphertext too short");
  return gcm(key, sealed.subarray(0, NONCE_BYTES), aad).decrypt(sealed.subarray(NONCE_BYTES));
}

export const newKey = () => randomBytes(KEY_BYTES);
