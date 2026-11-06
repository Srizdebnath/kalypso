import { encodeField, fromUtf8, utf8, hkdf, sha256, concat, type FieldValue } from "@arkivzk/crypto";

export const SLOTS = 8;

/** What gets encrypted into `ct`. Salt lives INSIDE the ciphertext, so shredding the DEK kills it too. */
export type RecordPlaintext = {
  v: 1;
  schemaId: string;
  recordId: string; // hex, also the guardian key id
  fields: string[]; // field names in slot order (max 8)
  values: Record<string, FieldValue>;
  salt: string; // decimal bigint, commitment salt
  createdAt: number;
  attachment?: { name: string; type: string; swarmRef: string; size: number };
  /** relations to parent records (recordIds), restored on a new device by `recover` */
  parents?: { recordId: string; relation: string }[];
};

export function encodeRecord(r: RecordPlaintext): Uint8Array {
  return utf8(JSON.stringify(r));
}

export function decodeRecord(b: Uint8Array): RecordPlaintext {
  const r = JSON.parse(fromUtf8(b));
  if (r?.v !== 1 || !Array.isArray(r.fields) || typeof r.salt !== "string") throw new Error("not an arkivzk record");
  return r as RecordPlaintext;
}

/** Map named values into the 8 circuit slots (unused slots = 0). */
export function toSlots(fields: string[], values: Record<string, FieldValue>): bigint[] {
  if (fields.length > SLOTS) throw new Error(`max ${SLOTS} committed fields per record`);
  const out = new Array<bigint>(SLOTS).fill(0n);
  fields.forEach((f, i) => {
    if (!(f in values)) throw new Error(`missing field ${f}`);
    out[i] = encodeField(values[f]);
  });
  return out;
}

export const recordAad = (schemaId: string, recordId: string) => utf8(`arkivzk.record.v1|${schemaId}|${recordId}`);
export const attachmentAad = (recordId: string) => utf8(`arkivzk.attachment.v1|${recordId}`);

export function epochOf(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Two-level key hierarchy: content key = HKDF(recordDEK || collectionKey).
 * Destroying EITHER kills the record: record DEK -> one record; collection key -> every record
 * of that schema+epoch at once (O(1) key operations, independent of record count).
 */
export function contentKey(recordDek: Uint8Array, collectionKey: Uint8Array): Uint8Array {
  return hkdf(sha256, concat(recordDek, collectionKey), undefined, utf8("arkivzk/content/v1"), 32);
}
