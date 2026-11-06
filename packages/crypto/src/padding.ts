import { concat, readU32be, u32be } from "./bytes.js";

/**
 * Size buckets. Ciphertext length on Arkiv only reveals the bucket, never the real size.
 * Top bucket stays below Arkiv's 128 KiB per-bytes-value limit after AEAD overhead.
 */
export const BUCKETS = [256, 1024, 4096, 16384, 65536, 120 * 1024] as const;

export function pad(data: Uint8Array): Uint8Array {
  const need = data.length + 4;
  const size = BUCKETS.find((b) => b >= need);
  if (!size) throw new Error(`payload too large: ${data.length} bytes (max ${BUCKETS.at(-1)! - 4})`);
  const out = new Uint8Array(size);
  out.set(concat(u32be(data.length), data));
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  const len = readU32be(padded, 0);
  if (len + 4 > padded.length) throw new Error("corrupt padding");
  for (let i = 4 + len; i < padded.length; i++) if (padded[i] !== 0) throw new Error("corrupt padding");
  return padded.slice(4, 4 + len);
}
