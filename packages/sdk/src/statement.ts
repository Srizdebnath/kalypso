import { sha256, utf8, toHex, encodeField, U64_MAX, type FieldValue } from "@arkivzk/crypto";

export type Claim = { field: string; min?: number | bigint; max?: number | bigint; equals?: FieldValue };

/** Public description of what a proof proves. Stored on Arkiv next to the proof. */
export type ProofStatement = {
  v: 1;
  circuitId: string;
  recordKey: `0x${string}`;
  field: string;
  slot: number;
  min: string;
  max: string;
  equals?: FieldValue;
  nonce: string;
  publicInputs: string[];
};

const trunc248 = (b: Uint8Array) => b.subarray(0, 31).reduce((a, x) => (a << 8n) | BigInt(x), 0n);

/** Binds a proof to one record and one verifier challenge. */
export const contextFor = (recordKey: string, nonce: string) =>
  trunc248(sha256(utf8(`arkivzk/ctx/v1|${recordKey.toLowerCase()}|${nonce}`)));

/** Indexed, so a verifier can query all proofs answering its challenge. */
export const audienceFor = (nonce: string) => toHex(sha256(utf8(`arkivzk/audience/v1|${nonce}`)));

export function describeClaim(s: Pick<ProofStatement, "field" | "min" | "max" | "equals">): string {
  if (s.equals !== undefined) return `${s.field} = ${String(s.equals)}`;
  const min = BigInt(s.min), max = BigInt(s.max);
  if (max === U64_MAX) return `${s.field} >= ${min}`;
  if (min === 0n) return `${s.field} <= ${max}`;
  return `${s.field} in [${min}, ${max}]`;
}

/** For equality claims the public value must be the encoding of the claimed plaintext. */
export function equalsConsistent(s: ProofStatement) {
  if (s.equals === undefined) return true;
  const enc = encodeField(s.equals).toString();
  return s.min === enc && s.max === enc;
}
