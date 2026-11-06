/**
 * Client <-> guardian protocol. Every request is signed by the record's controller key (Ed25519).
 * Shares travel sealed with hybrid ML-KEM-768 + X25519 (see @arkivzk/crypto hpke*).
 * Every guardian response that matters is signed by the guardian's Ed25519 key.
 */

export const DOMAIN = {
  put: "guardian.put",
  fetch: "guardian.fetch",
  shred: "guardian.shred",
  stored: "guardian.stored",
  destroyed: "guardian.destroyed",
  extend: "guardian.extend",
  extended: "guardian.extended",
} as const;

export const MAX_SKEW_MS = 5 * 60 * 1000;

export type GuardianInfo = {
  name: string;
  signPublicKey: string; // hex ed25519
  kemPublicKey: string; // hex ml-kem768+x25519
  version: 1;
  sharesHeld: number;
  persistence: "ram" | "disk";
};

export type PutShareRequest = {
  recordId: string;
  controller: string; // hex ed25519 public key
  sealedShare: string; // hex, hpkeSeal(guardianKemPk, share, "share-put:" + recordId)
  expiresAt: number; // unix ms; guardian destroys the share itself after this (auto-shred)
  ts: number;
  sig: string; // controller sig over {recordId, controller, sealedShareHash, expiresAt, ts}
};

export type StoredAttestation = {
  guardian: string; // sign public key
  recordId: string;
  expiresAt: number;
  ts: number;
  sig: string;
};

export type FetchShareRequest = {
  recordId: string;
  clientKemPk: string; // ephemeral, share is sealed back to this key
  nonce: string;
  ts: number;
  sig: string; // controller sig over {recordId, clientKemPk, nonce, ts}
};

export type FetchShareResponse = { sealedShare: string };

export type ShredRequestBody = {
  recordIds: string[];
  controller: string;
  nonce: string;
  ts: number;
  reason: "user" | "account" | "expiry";
};
export type ShredRequest = ShredRequestBody & { sig: string };

export type DestroyedAttestationBody = {
  guardian: string;
  guardianName: string;
  requestHash: string; // sha256 of canonical ShredRequest (incl. sig)
  results: { recordId: string; status: "destroyed" | "absent" }[];
  ts: number;
};
export type DestroyedAttestation = DestroyedAttestationBody & { sig: string };

/** Lease renewal: keys must live exactly as long as the data on Arkiv. */
export type ExtendRequestBody = { recordIds: string[]; controller: string; expiresAt: number; nonce: string; ts: number };
export type ExtendRequest = ExtendRequestBody & { sig: string };
export type ExtendedAttestation = {
  guardian: string;
  results: { recordId: string; status: "extended" | "absent"; expiresAt: number }[];
  ts: number;
  sig: string;
};
