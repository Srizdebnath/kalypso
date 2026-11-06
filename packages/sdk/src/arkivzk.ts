import { ExpirationTime, MAX_LIFETIME, type PublicArkivClient } from "@arkiv-network/sdk";
import { eq, and } from "@arkiv-network/sdk/query";
import { u64 } from "@arkiv-network/sdk/schema";
import {
  aead, pad, unpad, shamir, hkdf, sha256, utf8, fromUtf8, toHex, fromHex, randomBytes, zeroize,
  encodeField, randomFieldSalt, fieldHex, U64_MAX, type FieldValue,
} from "@arkivzk/crypto";
import {
  APP, ZkRecord, ZkProof, ZkVerificationKey, ShredReceipt, guardedBatch, encodeRecord, decodeRecord, toSlots,
  recordAad, attachmentAad, epochOf, type WriteEnv, type RecordPlaintext,
} from "@arkivzk/core";
import {
  Vault, GuardianClient, buildShredRequest, type VaultRecord,
} from "@arkivzk/vault";
import {
  computeCommitment, proveRange, rangeVerificationKey, vkHash, RANGE_CIRCUIT_ID, SLOTS,
} from "@arkivzk/zk";
import { contextFor, audienceFor, describeClaim, type Claim, type ProofStatement } from "./statement.js";

export type Hex = `0x${string}`;
const BLOCK_SECONDS = 2;

/** Encrypted blob storage for attachments (Swarm in the reference app). */
export interface BlobStore {
  upload(data: Uint8Array): Promise<string>;
  download(ref: string): Promise<Uint8Array>;
  readonly name: string;
}

export type ArkivZKConfig = {
  publicClient: PublicArkivClient;
  write: WriteEnv;
  vault: Vault;
  /** exactly two guardians: shares #2 and #3 of a 2-of-3 split (share #1 stays on the device) */
  guardians: [GuardianClient, GuardianClient];
  blobs?: BlobStore;
};

export type PutInput = {
  schemaId: string;
  values: Record<string, FieldValue>;
  attachment?: { name: string; type: string; bytes: Uint8Array };
  /** how long the data (and its keys) live. Arkiv max is ~182 days per lease; renew to keep longer. */
  retentionSeconds: number;
};

export type PutResult = { entityKey: Hex; txHash: Hex; expiresAtBlock: bigint; commitment: string; swarmRef?: string };

export type Step = (msg: string) => void;
const noop: Step = () => {};

/** Pad an attachment to the next power of two (min 4 KiB) so its size leaks only coarsely. */
function padPow2(b: Uint8Array) {
  let size = 4096;
  while (size < b.length + 8) size *= 2;
  const out = new Uint8Array(size);
  new DataView(out.buffer).setBigUint64(0, BigInt(b.length));
  out.set(b, 8);
  return out;
}
function unpadPow2(b: Uint8Array) {
  const n = Number(new DataView(b.buffer, b.byteOffset).getBigUint64(0));
  return b.slice(8, 8 + n);
}

const attachmentKey = (dek: Uint8Array) => hkdf(sha256, dek, undefined, utf8("arkivzk/attachment/v1"), 32);

export class ArkivZK {
  constructor(readonly cfg: ArkivZKConfig) {}

  get vault() { return this.cfg.vault; }
  get publicClient() { return this.cfg.publicClient; }

  private async blockNow() {
    return this.cfg.publicClient.getBlockNumber();
  }
  private msAt(block: bigint, now: bigint) {
    return Date.now() + Number(block - now) * BLOCK_SECONDS * 1000;
  }

  // ------------------------------------------------------------------ put
  async put(input: PutInput, step: Step = noop): Promise<PutResult> {
    const fields = Object.keys(input.values);
    if (fields.length === 0 || fields.length > SLOTS) throw new Error(`a record needs 1..${SLOTS} fields`);
    const blocks = Math.ceil(input.retentionSeconds / BLOCK_SECONDS);
    if (blocks < 30 || BigInt(blocks) > MAX_LIFETIME) throw new Error("retention must be between 1 minute and ~182 days");

    const recordId = toHex(randomBytes(16));
    const dek = aead.newKey();
    const salt = randomFieldSalt();
    try {
      step("Committing fields (Poseidon2)…");
      const commitment = fieldHex(await computeCommitment(toSlots(fields, input.values), salt));

      let attachment: RecordPlaintext["attachment"];
      if (input.attachment) {
        if (!this.cfg.blobs) throw new Error("no blob store configured for attachments");
        step(`Encrypting attachment and uploading to ${this.cfg.blobs.name}…`);
        const ct = aead.seal(attachmentKey(dek), padPow2(input.attachment.bytes), attachmentAad(recordId));
        const ref = await this.cfg.blobs.upload(ct);
        attachment = { name: input.attachment.name, type: input.attachment.type, swarmRef: ref, size: input.attachment.bytes.length };
      }

      step("Encrypting record (AES-256-GCM, padded)…");
      const plaintext: RecordPlaintext = {
        v: 1, schemaId: input.schemaId, recordId, fields, values: input.values, salt: salt.toString(),
        createdAt: Date.now(), attachment,
      };
      const ct = aead.seal(dek, pad(encodeRecord(plaintext)), recordAad(input.schemaId, recordId));

      step("Splitting key 2-of-3 and sending shares to guardians (ML-KEM-768 + X25519)…");
      const [deviceShare, s1, s2] = shamir.split(dek, 3, 2);
      const keyExpiresAt = Date.now() + input.retentionSeconds * 1000;
      const [g1, g2] = this.cfg.guardians;
      const atts = await Promise.allSettled([
        g1.putShare(this.vault, recordId, s1, keyExpiresAt),
        g2.putShare(this.vault, recordId, s2, keyExpiresAt),
      ]);
      if (atts.some((a) => a.status === "rejected")) {
        // never leave a half-stored key behind
        await this.shredGuardians([recordId], "user").catch(() => {});
        const err = atts.find((a) => a.status === "rejected") as PromiseRejectedResult;
        throw new Error(`guardian storage failed: ${err.reason?.message ?? err.reason}`);
      }

      step("Writing encrypted entity to Arkiv (confirm in wallet)…");
      let res;
      try {
        res = await guardedBatch(this.cfg.write, {
          creates: [{
            schema: ZkRecord,
            values: {
              app: APP, schemaId: input.schemaId, epoch: epochOf(), commitment, ct,
              envId: this.vault.sealEnvId(recordId),
              ...(attachment ? { swarmRef: attachment.swarmRef } : {}),
            },
            expiration: ExpirationTime.fromBlocks(blocks),
            flags: { readonly: true, permissionlessExtension: false },
            salt: BigInt(toHex(randomBytes(15))),
          }],
        });
      } catch (e) {
        await this.shredGuardians([recordId], "user").catch(() => {});
        throw e;
      }
      const entityKey = res.createdEntities[0] as Hex;
      const entity = await this.publicClient.getEntity(entityKey, ZkRecord);
      const now = await this.blockNow();
      const guardianKeys = await Promise.all(this.cfg.guardians.map(async (g) => (await g.info()).signPublicKey));

      await this.vault.saveRecord({
        entityKey: entityKey.toLowerCase() as Hex, recordId, schemaId: input.schemaId, fields, commitment,
        createdAt: Date.now(), expiresAtBlock: entity.$expiresAt.toString(), expiresAtMs: this.msAt(entity.$expiresAt, now),
        swarmRef: attachment?.swarmRef, guardians: guardianKeys, deviceShare: toHex(deviceShare), status: "live", proofKeys: [],
      });
      zeroize(deviceShare, s1, s2);
      step("Done");
      return { entityKey, txHash: res.txHash as Hex, expiresAtBlock: entity.$expiresAt, commitment, swarmRef: attachment?.swarmRef };
    } finally {
      zeroize(dek);
    }
  }

  // ------------------------------------------------------------------ keys
  /** Rebuild a record's DEK from any 2 of: device share, guardian 1, guardian 2. */
  private async dekFor(r: VaultRecord, log: Step = noop): Promise<Uint8Array> {
    const shares: Uint8Array[] = [];
    if (r.deviceShare) { shares.push(fromHex(r.deviceShare)); log("device share: present"); }
    else log("device share: none (destroyed or new device)");
    for (const g of this.cfg.guardians) {
      if (shares.length >= 2) break;
      try { shares.push(await g.fetchShare(this.vault, r.recordId)); log(`${(await g.info()).name}: share released`); }
      catch (e: any) { log(`${g.url}: ${e.message}`); }
    }
    if (shares.length < 2) throw new Error("fewer than 2 key shares exist - this record's key is destroyed");
    const dek = shamir.combine(shares);
    shares.forEach((s) => zeroize(s));
    return dek;
  }

  private async requireRecord(entityKey: string) {
    const r = await this.vault.getRecord(entityKey);
    if (!r) throw new Error("record not in this vault (use recovery to import it)");
    return r;
  }

  // ------------------------------------------------------------------ get
  async get(entityKey: string): Promise<{ record: RecordPlaintext; attachment?: Uint8Array }> {
    const r = await this.requireRecord(entityKey);
    if (r.status === "shredded") throw new Error("record was shredded");
    const entity = await this.publicClient.getEntity(entityKey as Hex, ZkRecord);
    const dek = await this.dekFor(r);
    try {
      const record = decodeRecord(unpad(aead.open(dek, fromHex(entity.ct.value), recordAad(r.schemaId, r.recordId))));
      if (record.recordId !== r.recordId) throw new Error("record id mismatch");
      let attachment: Uint8Array | undefined;
      if (record.attachment && this.cfg.blobs) {
        const ct = await this.cfg.blobs.download(record.attachment.swarmRef);
        attachment = unpadPow2(aead.open(attachmentKey(dek), ct, attachmentAad(r.recordId)));
      }
      return { record, attachment };
    } finally {
      zeroize(dek);
    }
  }

  // ------------------------------------------------------------------ list (+ expiry erasure)
  async list(): Promise<VaultRecord[]> {
    const recs = await this.vault.listRecords();
    const now = Date.now();
    for (const r of recs) {
      if (r.status === "live" && r.expiresAtMs <= now) {
        // retention over: guardians already auto-destroyed their shares; drop ours too
        r.status = "expired";
        await this.vault.forgetSecrets(r.entityKey, { status: "expired" });
      }
    }
    return recs;
  }

  // ------------------------------------------------------------------ prove
  async prove(entityKey: string, claim: Claim, verifierNonce: string, step: Step = noop) {
    const r = await this.requireRecord(entityKey);
    if (r.status !== "live") throw new Error(`record is ${r.status}`);
    const slot = r.fields.indexOf(claim.field);
    if (slot < 0) throw new Error(`unknown field ${claim.field}`);
    if (!verifierNonce || verifierNonce.length > 100) throw new Error("verifier nonce required (max 100 chars)");

    step("Decrypting record locally…");
    const { record } = await this.get(entityKey);
    const fields = toSlots(record.fields, record.values);
    const salt = BigInt(record.salt);

    let min: bigint, max: bigint;
    if (claim.equals !== undefined) min = max = encodeField(claim.equals);
    else {
      min = claim.min !== undefined ? BigInt(claim.min) : 0n;
      max = claim.max !== undefined ? BigInt(claim.max) : U64_MAX;
    }
    const key = entityKey.toLowerCase() as Hex;
    const context = contextFor(key, verifierNonce);
    step("Generating zero-knowledge proof (UltraHonk)…");
    const t0 = Date.now();
    const p = await proveRange(fields, salt, { commitment: BigInt(r.commitment), slot, min, max, context });
    const proveMs = Date.now() - t0;

    const vk = await rangeVerificationKey();
    const vkh = vkHash(vk);
    const statement: ProofStatement = {
      v: 1, circuitId: RANGE_CIRCUIT_ID, recordKey: key, field: claim.field, slot,
      min: min.toString(), max: max.toString(), equals: claim.equals, nonce: verifierNonce, publicInputs: p.publicInputs,
    };
    const label = describeClaim(statement);

    step("Checking verification key registry on Arkiv…");
    const vkExists = await this.publicClient.select({ $key: true }).from(ZkVerificationKey)
      .where(and(eq("app", APP), eq("vkHash", vkh))).limit(1).fetch();

    step("Publishing proof to Arkiv (confirm in wallet)…");
    const recEntity = await this.publicClient.getEntity(key, ZkRecord);
    const res = await guardedBatch(this.cfg.write, {
      creates: [
        {
          schema: ZkProof,
          values: {
            app: APP, recordKey: key, circuitId: RANGE_CIRCUIT_ID, vkHash: vkh, audience: audienceFor(verifierNonce),
            claim: label.slice(0, 120), statement: utf8(JSON.stringify(statement)), proof: p.proof,
          },
          // a proof never outlives its record
          expiration: ExpirationTime.atBlock(recEntity.$expiresAt),
          flags: { readonly: true, permissionlessExtension: false },
        },
        ...(vkExists.entities.length === 0
          ? [{
              schema: ZkVerificationKey,
              values: { app: APP, circuitId: RANGE_CIRCUIT_ID, vkHash: vkh, vk },
              expiration: ExpirationTime.max(),
              flags: { readonly: true, permissionlessExtension: true },
            }]
          : []),
      ] as any,
    });
    const proofEntityKey = res.createdEntities[0] as Hex;
    await this.vault.saveRecord({ ...r, proofKeys: [...r.proofKeys, proofEntityKey.toLowerCase() as Hex] });
    return { proofEntityKey, txHash: res.txHash as Hex, statementText: label, proveMs };
  }

  // ------------------------------------------------------------------ shred
  private async shredGuardians(recordIds: string[], reason: "user" | "account" | "expiry") {
    const req = buildShredRequest(this.vault, recordIds, reason);
    const settled = await Promise.allSettled(this.cfg.guardians.map((g) => g.shred(req)));
    return { req, settled };
  }

  /**
   * Crypto-shred records:
   *  1. both guardians destroy their shares and sign attestations (need >= 1 so that < 2 shares survive)
   *  2. device share is deleted
   *  3. ONE atomic Arkiv tx: delete record + its proofs, create a ShredReceipt per record
   */
  async shred(entityKeys: string[], onStep: (id: string, status: "running" | "done" | "error", detail?: string) => void = () => {}) {
    const recs: VaultRecord[] = [];
    for (const k of entityKeys) {
      const r = await this.requireRecord(k);
      if (r.status === "shredded" && !r.pendingShred) throw new Error(`${k} is already shredded`);
      recs.push(r);
    }
    const fresh = recs.filter((r) => !r.pendingShred);
    if (fresh.length) {
      const { req, settled } = await this.shredGuardians(fresh.map((r) => r.recordId), "user");
      const attestations = [];
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const id = `guardian-${i + 1}`;
        if (s.status === "fulfilled") { attestations.push(s.value); onStep(id, "done", `${s.value.guardianName} signed destruction`); }
        else onStep(id, "error", String(s.reason?.message ?? s.reason));
      }
      if (attestations.length === 0) throw new Error("no guardian confirmed destruction - nothing was changed, try again");

      onStep("device", "running");
      for (const r of fresh) {
        const live: Hex[] = [];
        for (const k of [r.entityKey, ...r.proofKeys]) {
          try { await this.publicClient.getEntity(k as Hex); live.push(k as Hex); } catch { /* expired or gone */ }
        }
        await this.vault.forgetSecrets(r.entityKey, { status: "shredded", pendingShred: { request: req, attestations, liveEntities: live } });
      }
      onStep("device", "done", "device share erased");
    }
    return this.publishShredReceipts(recs.map((r) => r.entityKey), onStep);
  }

  /** Step 3 of shred, safe to retry: keys are already gone, this only cleans Arkiv and publishes receipts. */
  async publishShredReceipts(entityKeys: string[], onStep: (id: string, status: "running" | "done" | "error", detail?: string) => void = () => {}) {
    const recs = (await Promise.all(entityKeys.map((k) => this.vault.getRecord(k)))).filter((r): r is VaultRecord => !!r?.pendingShred);
    if (recs.length === 0) throw new Error("nothing pending");
    onStep("arkiv", "running", "deleting entities + publishing receipts in one transaction");
    const deletes: { entityKey: Hex }[] = [];
    for (const r of recs) for (const k of r.pendingShred!.liveEntities) {
      try { await this.publicClient.getEntity(k); deletes.push({ entityKey: k }); } catch { /* already gone */ }
    }
    let res;
    try {
      res = await guardedBatch(this.cfg.write, {
        deletes,
        creates: recs.map((r) => ({
          schema: ShredReceipt,
          values: {
            app: APP, recordKey: r.entityKey, level: "record", shreddedAt: u64(BigInt(Date.now())),
            request: utf8(JSON.stringify(r.pendingShred!.request)),
            attestations: utf8(JSON.stringify(r.pendingShred!.attestations)),
          },
          expiration: ExpirationTime.max(),
          flags: { readonly: true, permissionlessExtension: true },
        })),
      });
    } catch (e: any) {
      onStep("arkiv", "error", e.message);
      throw e;
    }
    const receipts = res.createdEntities as Hex[];
    for (let i = 0; i < recs.length; i++) {
      const { pendingShred, ...rest } = recs[i];
      await this.vault.saveRecord({ ...rest, status: "shredded", receiptKey: receipts[i].toLowerCase() as Hex, proofKeys: [] });
    }
    onStep("arkiv", "done", `tx ${res.txHash}`);
    return { txHash: res.txHash as Hex, receipts, deleted: deletes.map((d) => d.entityKey) };
  }

  // ------------------------------------------------------------------ recovery (lost device)
  /** With a restored vault (recovery kit), find this wallet's records on Arkiv and re-attach via guardian shares. */
  async recover(owner: Hex, step: Step = noop) {
    const found: Hex[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.publicClient.select({ $key: true, $expiresAt: true, envId: true, schemaId: true, commitment: true, swarmRef: true })
        .from(ZkRecord).where(eq("app", APP)).ownedBy(owner).limit(100).offset(offset).fetch();
      for (const e of page.entities) {
        const recordId = this.vault.openEnvId(fromHex(e.envId.value));
        if (!recordId || (await this.vault.getRecord(e.$key))) continue;
        const now = await this.blockNow();
        const guardians = await Promise.all(this.cfg.guardians.map(async (g) => (await g.info()).signPublicKey));
        const r: VaultRecord = {
          entityKey: e.$key.toLowerCase() as Hex, recordId, schemaId: e.schemaId.value, fields: [], commitment: e.commitment.value,
          createdAt: Date.now(), expiresAtBlock: e.$expiresAt.toString(), expiresAtMs: this.msAt(e.$expiresAt, now),
          swarmRef: e.swarmRef?.value, guardians, status: "live", proofKeys: [],
        };
        try {
          const ent = await this.publicClient.getEntity(e.$key, ZkRecord);
          const dek = await this.dekFor(r);
          const rec = decodeRecord(unpad(aead.open(dek, fromHex(ent.ct.value), recordAad(r.schemaId, recordId))));
          zeroize(dek);
          r.fields = rec.fields;
          r.createdAt = rec.createdAt;
          await this.vault.saveRecord(r);
          found.push(r.entityKey);
          step(`recovered ${r.entityKey}`);
        } catch (err: any) {
          step(`skipped ${e.$key}: ${err.message}`);
        }
      }
      if (page.entities.length + page.skipped < 100) break;
      offset += 100;
    }
    return found;
  }

  // ------------------------------------------------------------------ "break it": decrypt archived calldata
  /**
   * Given raw ciphertext + envId captured by an archive node, try to decrypt with every key share
   * that still exists anywhere. Before shred this succeeds for the owner; after shred it can't.
   */
  async tryDecryptCaptured(ct: Uint8Array, envId: Uint8Array, schemaId: string) {
    const log: string[] = [];
    const recordId = this.vault.openEnvId(envId);
    if (!recordId) { log.push("envId does not open with this vault's key: not our record, or identity destroyed"); return { success: false, log }; }
    log.push(`envId opened -> recordId ${recordId.slice(0, 10)}…`);
    const local = (await this.vault.listRecords()).find((r) => r.recordId === recordId);
    const r: VaultRecord = local ?? {
      entityKey: "0x", recordId, schemaId, fields: [], commitment: "", createdAt: 0, expiresAtBlock: "0", expiresAtMs: 0,
      guardians: [], status: "live", proofKeys: [],
    } as VaultRecord;
    let dek: Uint8Array;
    try { dek = await this.dekFor(r, (m) => log.push(m)); }
    catch (e: any) { log.push(e.message); log.push("RESULT: ciphertext is undecryptable noise"); return { success: false, log }; }
    try {
      const rec = decodeRecord(unpad(aead.open(dek, ct, recordAad(schemaId, recordId))));
      log.push(`decrypted: ${JSON.stringify(rec.values)}`);
      return { success: true, log };
    } catch {
      log.push("key reconstructed but AES-GCM authentication failed");
      return { success: false, log };
    } finally { zeroize(dek); }
  }
}
