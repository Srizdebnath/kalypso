import type { PublicArkivClient } from "@arkiv-network/sdk";
import { eq, and } from "@arkiv-network/sdk/query";
import { fromHex, fromUtf8, fieldHex, sha256Hex } from "@arkivzk/crypto";
import { APP, ZkProof, ZkRecord, ZkVerificationKey, ShredReceipt, type DestroyedAttestation, type ShredRequest } from "@arkivzk/core";
import { verifyDestroyedAttestation, verifyShredRequest } from "@arkivzk/vault";
import { verifyRange, rangeVerificationKey, vkHash as hashVk, RANGE_CIRCUIT_ID } from "@arkivzk/zk";
import { contextFor, describeClaim, equalsConsistent, type ProofStatement } from "./statement.js";

type Hex = `0x${string}`;
export type RecordState = "live" | "shredded" | "expired";

export type VerifyResult = {
  valid: boolean;
  statementText: string;
  recordKey: string;
  recordStatus: RecordState;
  vkHash: string;
  checks: { name: string; ok: boolean; detail?: string }[];
  reason?: string;
  receiptKey?: string;
};

export async function recordState(pc: PublicArkivClient, recordKey: string): Promise<{ state: RecordState; receiptKey?: string; commitment?: string }> {
  try {
    const e = await pc.getEntity(recordKey as Hex, ZkRecord);
    return { state: "live", commitment: e.commitment.value };
  } catch {
    const r = await pc.select({ $key: true }).from(ShredReceipt)
      .where(and(eq("app", APP), eq("recordKey", recordKey.toLowerCase()))).limit(1).fetch();
    return r.entities[0] ? { state: "shredded", receiptKey: r.entities[0].$key } : { state: "expired" };
  }
}

/**
 * Verify a proof using only public Arkiv data. No wallet, no keys, no plaintext.
 * A proof is valid only if: the VK on Arkiv matches the shipped circuit, the statement is bound to
 * this record + nonce, the commitment matches the LIVE record, and the UltraHonk proof verifies.
 */
export async function verifyProofEntity(pc: PublicArkivClient, proofKey: string): Promise<VerifyResult> {
  const checks: VerifyResult["checks"] = [];
  let p;
  try { p = await pc.getEntity(proofKey as Hex, ZkProof); }
  catch { return { valid: false, statementText: "", recordKey: "", recordStatus: "expired", vkHash: "", checks, reason: "Proof entity not found on Arkiv (deleted with its record, or expired)" }; }

  const st = JSON.parse(fromUtf8(fromHex(p.statement.value))) as ProofStatement;
  const statementText = describeClaim(st);
  const out = (valid: boolean, extra: Partial<VerifyResult> = {}): VerifyResult => ({
    valid, statementText, recordKey: p.recordKey.value, recordStatus: "live", vkHash: p.vkHash.value, checks, ...extra,
  });

  checks.push({ name: "statement bound to this record", ok: st.recordKey === p.recordKey.value.toLowerCase() });
  checks.push({ name: "known circuit", ok: st.circuitId === RANGE_CIRCUIT_ID && p.circuitId.value === RANGE_CIRCUIT_ID });

  // VK: fetched from Arkiv registry, must hash to vkHash AND equal the VK of the circuit shipped in this library
  const vkRows = await pc.select({ vk: true }).from(ZkVerificationKey)
    .where(and(eq("app", APP), eq("vkHash", p.vkHash.value))).limit(1).fetch();
  const vk = vkRows.entities[0] ? fromHex(vkRows.entities[0].vk.value) : undefined;
  const localVkHash = hashVk(await rangeVerificationKey());
  checks.push({ name: "verification key found in Arkiv registry", ok: !!vk });
  checks.push({ name: "registry VK hash matches", ok: !!vk && hashVk(vk) === p.vkHash.value });
  checks.push({ name: "VK equals the audited circuit's VK", ok: p.vkHash.value === localVkHash, detail: localVkHash.slice(0, 18) + "…" });

  const expectedCtx = fieldHex(contextFor(st.recordKey, st.nonce));
  checks.push({ name: "proof bound to verifier nonce", ok: st.publicInputs[4] === expectedCtx, detail: `nonce "${st.nonce}"` });
  checks.push({ name: "public claim matches public inputs", ok:
    BigInt(st.publicInputs[1]) === BigInt(st.slot) && BigInt(st.publicInputs[2]) === BigInt(st.min) &&
    BigInt(st.publicInputs[3]) === BigInt(st.max) && equalsConsistent(st) });

  const rs = await recordState(pc, st.recordKey);
  if (rs.state !== "live") {
    checks.push({ name: "record is live", ok: false, detail: rs.state });
    return out(false, { recordStatus: rs.state, receiptKey: rs.receiptKey, reason: rs.state === "shredded" ? "Record was crypto-shredded: proof revoked" : "Record expired: proof no longer backed by data" });
  }
  checks.push({ name: "commitment matches live record", ok: rs.commitment === st.publicInputs[0] });

  const ok = checks.every((c) => c.ok);
  if (!ok || !vk) return out(false, { reason: "a binding check failed" });

  const cryptoOk = await verifyRange(
    fromHex(p.proof.value),
    { commitment: BigInt(st.publicInputs[0]), slot: st.slot, min: BigInt(st.min), max: BigInt(st.max), context: BigInt(expectedCtx) },
    vk,
  );
  checks.push({ name: "UltraHonk proof verifies", ok: cryptoOk });
  return out(cryptoOk, cryptoOk ? {} : { reason: "proof does not verify" });
}

export type ReceiptView = {
  receiptKey: string;
  recordKey: string;
  level: string;
  shreddedAt: number;
  request: ShredRequest;
  requestValid: boolean;
  attestations: (DestroyedAttestation & { valid: boolean })[];
  sharesDestroyed: number;
  recordStillLive: boolean;
};

export async function getReceipt(pc: PublicArkivClient, receiptKey: string): Promise<ReceiptView> {
  const e = await pc.getEntity(receiptKey as Hex, ShredReceipt);
  const request = JSON.parse(fromUtf8(fromHex(e.request.value))) as ShredRequest;
  const atts = JSON.parse(fromUtf8(fromHex(e.attestations.value))) as DestroyedAttestation[];
  const attestations = atts.map((a) => ({ ...a, valid: verifyDestroyedAttestation(a, request) }));
  const validGuardians = new Set(attestations.filter((a) => a.valid).map((a) => a.guardian));
  let live = true;
  try { await pc.getEntity(e.recordKey.value as Hex); } catch { live = false; }
  return {
    receiptKey, recordKey: e.recordKey.value, level: e.level.value, shreddedAt: Number(e.shreddedAt.value),
    request, requestValid: verifyShredRequest(request), attestations,
    // + 1 for the device share, which the client deleted itself (not externally attestable)
    sharesDestroyed: validGuardians.size, recordStillLive: live,
  };
}

/** Machine-readable erasure certificate (GDPR Art. 17 style). Everything in it is independently verifiable. */
export function erasureCertificate(r: ReceiptView, txHash?: string) {
  return {
    type: "arkivzk.erasure-certificate.v1",
    issuedAt: new Date().toISOString(),
    subject: { arkivEntity: r.recordKey, network: "Arkiv Rabdi (chain 7794095)" },
    method: "crypto-shredding: 2-of-3 Shamir-split AES-256-GCM key; device share deleted locally, guardian shares destroyed with signed attestations",
    receipt: { arkivEntity: r.receiptKey, txHash },
    controllerRequest: r.request,
    controllerSignatureValid: r.requestValid,
    guardianAttestations: r.attestations,
    keySharesRemainingAtMost: Math.max(0, 3 - 1 - r.sharesDestroyed),
    threshold: 2,
    statement:
      r.sharesDestroyed >= 1
        ? "At most one key share can remain, below the threshold of two: the ciphertext, including copies held by archive nodes, cannot be decrypted."
        : "No guardian attestation verified: erasure NOT proven.",
    limits: [
      "Anyone who decrypted the data before erasure may still hold the plaintext.",
      "Public metadata (timestamps, schema id, size bucket, signing wallet) remains in chain history.",
      "Guardian destruction is attested by signature; it is not hardware-proven in this version.",
    ],
    verify: `sha256 of this JSON: computed by the verifier`,
    digest: sha256Hex(JSON.stringify(r.attestations)),
  };
}
