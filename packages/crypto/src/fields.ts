import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8 } from "./bytes.js";

/** BN254 scalar field modulus (what Noir/Barretenberg `Field` lives in). */
export const BN254_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const U64_MAX = (1n << 64n) - 1n;

const toBig = (b: Uint8Array) => b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);

/** 248-bit value, always < p. */
const trunc248 = (b: Uint8Array) => toBig(b.subarray(0, 31));

export type FieldValue = number | bigint | string | boolean;

/**
 * Encode one record value into a circuit field element.
 * - integers / bigints (0..2^64-1) -> the number itself (range-provable)
 * - booleans -> 0/1
 * - strings -> sha256("arkivzk/str\0" + s) truncated to 248 bits (equality-provable)
 */
export function encodeField(v: FieldValue): bigint {
  if (typeof v === "boolean") return v ? 1n : 0n;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`numeric fields must be non-negative safe integers: ${v}`);
    return BigInt(v);
  }
  if (typeof v === "bigint") {
    if (v < 0n || v > U64_MAX) throw new Error("bigint fields must fit in u64");
    return v;
  }
  return trunc248(sha256(utf8("arkivzk/str\0" + v)));
}

export const randomFieldSalt = () => trunc248(randomBytes(32));

export const fieldHex = (x: bigint) => "0x" + x.toString(16).padStart(64, "0");
