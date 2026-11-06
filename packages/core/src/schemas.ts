import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

/**
 * Everything below is PUBLIC and stays in Arkiv history forever.
 * Rule: no plaintext, no key material, nothing that links back to the user's real identity
 * beyond the wallet that signs (see docs/04).
 */

/** Encrypted record. */
export const ZkRecord = defineSchema("arkivzk.record.v1", {
  app: str().indexed(), // always "arkivzk" - lets explorers / verifiers find our entities
  schemaId: str().indexed(), // coarse record type, e.g. "medical.v1"
  epoch: str().indexed(), // "2026-11" - enables epoch-level views/shreds
  commitment: str().indexed(), // Poseidon2 commitment (hex) - proofs reference it
  ct: bytes(), // AES-256-GCM(DEK, pad(record)) - padded to a size bucket
  envId: bytes(), // AES-GCM(controller-derived key, recordId): lets the owner re-find guardian shares after device loss
  swarmRef: str().optional(), // Swarm reference of an encrypted attachment (same DEK family)
  // blind index: HMAC(per-collection key, field || value). Owner can search by exact value; others see random tags.
  bix0: str().indexed().optional(),
  bix1: str().indexed().optional(),
  bix2: str().indexed().optional(),
});

/** A ZK proof about a record. */
export const ZkProof = defineSchema("arkivzk.proof.v1", {
  app: str().indexed(),
  recordKey: str().indexed(),
  circuitId: str().indexed(),
  vkHash: str().indexed(),
  audience: str().indexed(), // sha256(verifier nonce): a verifier can query "proofs addressed to me"
  claim: str().indexed(), // e.g. "age>=18" - public statement label, filterable
  statement: bytes(), // JSON: public inputs + human labels
  proof: bytes(),
});

/** Verification key registry: verifiers fetch the VK from Arkiv and check it against the circuit. */
export const ZkVerificationKey = defineSchema("arkivzk.vk.v1", {
  app: str().indexed(),
  circuitId: str().indexed(),
  vkHash: str().indexed(),
  vk: bytes(),
});

/** Public, verifiable proof that the keys for a record were destroyed. One per shredded record. */
export const ShredReceipt = defineSchema("arkivzk.receipt.v1", {
  app: str().indexed(),
  recordKey: str().indexed(),
  level: str().indexed(), // record | account | expiry
  shreddedAt: u64(), // unix ms
  request: bytes(), // the controller-signed ShredRequest (JSON)
  attestations: bytes(), // guardian-signed destruction attestations (JSON)
});

export const APP = "arkivzk";
