import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex, utf8 } from "./bytes.js";

export type SignKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

export function signKeygen(): SignKeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export const signPublicKey = (secretKey: Uint8Array) => ed25519.getPublicKey(secretKey);

/** Deterministic, order-independent JSON for signing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k]))
      .join(",") +
    "}"
  );
}

const msg = (domain: string, payload: unknown) => utf8(`arkivzk/${domain}/v1\n` + canonicalJson(payload));

export function signPayload(secretKey: Uint8Array, domain: string, payload: unknown): `0x${string}` {
  return toHex(ed25519.sign(msg(domain, payload), secretKey));
}

export function verifyPayload(publicKey: Uint8Array, domain: string, payload: unknown, sig: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, msg(domain, payload), publicKey);
  } catch {
    return false;
  }
}

export const sha256Hex = (data: Uint8Array | string) =>
  toHex(sha256(typeof data === "string" ? utf8(data) : data));
