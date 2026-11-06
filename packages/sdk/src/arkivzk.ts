import { ExpirationTime, MAX_LIFETIME, type PublicArkivClient } from "@arkiv-network/sdk";
import { eq, and, or, gt, asc } from "@arkiv-network/sdk/query";
import { key } from "@arkiv-network/sdk";
import { u64 } from "@arkiv-network/sdk/schema";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  aead, pad, unpad, shamir, hkdf, sha256, utf8, toHex, fromHex, randomBytes, zeroize,
  encodeField, randomFieldSalt, fieldHex, U64_MAX, type FieldValue,
} from "@arkivzk/crypto";
import {
  APP, ZkRecord, ZkProof, ZkVerificationKey, ShredReceipt, guardedBatch, ArkivWriteError, encodeRecord, decodeRecord, toSlots,
  recordAad, attachmentAad, epochOf, contentKey, localKeyProvider, rangePath, rangeCover,
  type WriteEnv, type RecordPlaintext, type DestroyedAttestation, type ShredRequest,
} from "@arkivzk/core";
import { Vault, GuardianClient, GuardianError, buildShredRequest, type VaultRecord, type VaultCollection } from "@arkivzk/vault";
import { computeCommitment, proveRange, rangeVerificationKey, vkHash, RANGE_CIRCUIT_ID, SLOTS } from "@arkivzk/zk";
import { contextFor, audienceFor, describeClaim, type Claim, type ProofStatement } from "./statement.js";
import { liveKeys } from "./live.js";
import { QueryPlanner } from "./query.js";

export type Hex = `0x${string}`;
const BLOCK_SECONDS = 2;
const MAX_SEARCHABLE = 3;
/** equality terms per OR query: under the node query-size limit, and a multiple of 3 so one tag's 3 columns stay in one query (no double counting) */
const TERMS_PER_QUERY = 18;
/** creates per atomic transaction (bounded by the half-block gas rule; ~200k gas each) */
const MAX_BATCH_CREATES = 10;

/** Encrypted blob storage for attachments (Swarm in the reference app). */
export interface BlobStore {
  upload(data: Uint8Array): Promise<string>;
  download(ref: string): Promise<Uint8Array>;
  readonly name: string;
}

/** Pays gas for ephemeral signers from a shared pool, so records don't link back to the user's wallet. */
export interface Relayer {
  fund(address: Hex, minBalanceWei: bigint, sign: (message: string) => Promise<Hex>): Promise<void>;
}

export type ArkivZKConfig = {
  publicClient: PublicArkivClient;
  /** user's wallet (signs in "wallet" mode; used for reads/estimates in both modes) */
  write: WriteEnv;
  vault: Vault;
  /** exactly two guardians: shares #2 and #3 of every 2-of-3 split (share #1 stays on the device) */
  guardians: [GuardianClient, GuardianClient];
  blobs?: BlobStore;
  /** "wallet": records owned by the user's wallet. "ephemeral": fresh key per record, gas via relayer. */
  signer?: "wallet" | "ephemeral";
  relayer?: Relayer;
};

export type PutInput = {
  schemaId: string;
  values: Record<string, FieldValue>;
  attachment?: { name: string; type: string; bytes: Uint8Array };
  /** how long the data (and its keys) live. Arkiv max is ~182 days per lease; renew to keep longer. */
  retentionSeconds: number;
  /** up to 3 fields made exact-match searchable via blind index tags */
  searchable?: string[];
  /** one integer field (0..255) made range-searchable (8 tree tags) */
  rangeField?: string;
  /** entity key of a parent record in this vault: stored as a blind foreign key (JOIN + cascade shred) */
  parent?: string;
  /** up to 2 parents with a relation name; `{ index }` points at an earlier row of the same putMany batch */
  parents?: { key: string | { index: number }; relation?: string }[];
};

export type PutResult = { entityKey: Hex; txHash: Hex; expiresAtBlock: bigint; commitment: string; swarmRef?: string; signer: Hex };
export type ShredLevel = "record" | "collection" | "epoch" | "account";
export type ShredResult = { txHashes: Hex[]; receipts: Hex[]; deleted: Hex[]; level: ShredLevel; keysDestroyed: number };

export type Step = (msg: string) => void;
type StepFn = (id: string, status: "running" | "done" | "error", detail?: string) => void;
const noop: Step = () => {};

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
const attachmentKey = (k: Uint8Array) => hkdf(sha256, k, undefined, utf8("arkivzk/attachment/v1"), 32);

export class ArkivZK {
  readonly mode: "wallet" | "ephemeral";
  constructor(readonly cfg: ArkivZKConfig) {
    this.mode = cfg.signer ?? "wallet";
    if (this.mode === "ephemeral" && !cfg.relayer) throw new Error("ephemeral signer mode needs a relayer");
  }

  get vault() { return this.cfg.vault; }
  get publicClient() { return this.cfg.publicClient; }

  private msAt(block: bigint, now: bigint) {
    return Date.now() + Number(block - now) * BLOCK_SECONDS * 1000;
  }

  // ================================================================== signers
  /** Write environment for whoever owns this record on Arkiv. */
  private envFor(signer: "wallet" | "ephemeral", signerKey?: Hex): WriteEnv {
    if (signer === "wallet") return this.cfg.write;
    if (!signerKey) throw new Error("this record's signer key is gone (shredded): its Arkiv entity can only expire");
    const acct = privateKeyToAccount(signerKey);
    const relayer = this.cfg.relayer;
    if (!relayer) throw new Error("records written by a one-time signer need the relayer (config.relayer) for gas, also in wallet mode");
    return {
      ...this.cfg.write,
      provider: localKeyProvider(signerKey, this.cfg.write.chain, this.cfg.write.rpc),
      account: acct.address,
      ensureFunds: (address, cost) => relayer.fund(address, cost, (m) => acct.signMessage({ message: m })),
    };
  }

  /**
   * Run one batch per distinct owner, owners in parallel (ephemeral records each have their own owner).
   * If a batch would exceed the half-block gas rule, it is split in halves and the parts are sent
   * one after another. That check fails BEFORE signing, so nothing is resent.
   * Note: split parts are separate transactions, each atomic on its own.
   */
  async perSigner<T extends { signer: "wallet" | "ephemeral"; signerKey?: Hex }>(
    items: T[], build: (group: T[]) => Parameters<typeof guardedBatch>[1] | null,
    onResult?: (out: { group: T[]; res: Awaited<ReturnType<typeof guardedBatch>> }) => Promise<void>,
  ) {
    const groups = new Map<string, T[]>();
    for (const it of items) {
      const k = it.signer === "wallet" ? "wallet" : (it.signerKey ?? "gone");
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    type Out = { group: T[]; res: Awaited<ReturnType<typeof guardedBatch>> };
    const run = async (g: T[]): Promise<Out[]> => {
      const batch = build(g);
      if (!batch) return [];
      try {
        const out = { group: g, res: await guardedBatch(this.envFor(g[0].signer, g[0].signerKey), batch) };
        if (onResult) await onResult(out); // persist right away: a later chunk may fail
        return [out];
      } catch (e) {
        if (!(e instanceof ArkivWriteError && /Batch too large/.test(e.message) && g.length > 1)) throw e;
        const mid = Math.ceil(g.length / 2);
        return [...(await run(g.slice(0, mid))), ...(await run(g.slice(mid)))];
      }
    };
    return (await Promise.all([...groups.values()].map(run))).flat();
  }

  // ================================================================== key shares
  private async collectShares(id: string, deviceShare: string | undefined, log: Step = noop): Promise<Uint8Array> {
    const shares: Uint8Array[] = [];
    if (deviceShare) shares.push(fromHex(deviceShare));
    for (const g of this.cfg.guardians) {
      if (shares.length >= 2) break;
      try { shares.push(await g.fetchShare(this.vault, id)); log(`${(await g.info()).name}: share for ${id.slice(0, 10)}… released`); }
      catch (e: any) { log(`${g.url}: ${e.message}`); }
    }
    if (shares.length < 2) throw new Error(`fewer than 2 key shares exist for ${id.slice(0, 10)}… - this key is destroyed`);
    const k = shamir.combine(shares);
    shares.forEach((s) => zeroize(s));
    return k;
  }

  private async storeShares(id: string, secret: Uint8Array, expiresAt: number): Promise<string> {
    const [device, s1, s2] = shamir.split(secret, 3, 2);
    const [g1, g2] = this.cfg.guardians;
    const res = await Promise.allSettled([g1.putShare(this.vault, id, s1, expiresAt), g2.putShare(this.vault, id, s2, expiresAt)]);
    zeroize(s1, s2);
    const bad = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (bad) {
      await this.guardianShred([id], "user").catch(() => {});
      throw new Error(`guardian storage failed: ${bad.reason?.message ?? bad.reason}`);
    }
    const hex = toHex(device);
    zeroize(device);
    return hex;
  }

  /** Get (or create) the collection key for schema+epoch, making sure its lease covers `untilMs`. */
  private async collectionKey(schemaId: string, epoch: string, untilMs?: number, step: Step = noop): Promise<{ key: Uint8Array; collectionId: Hex }> {
    const collectionId = this.vault.collectionId(schemaId, epoch);
    let c = await this.vault.getCollection(collectionId);
    if (c?.status === "shredded") throw new Error(`collection ${schemaId}/${epoch} was shredded`);
    if (!c) {
      if (untilMs === undefined) {
        // known on another device only: fetch from guardians
        return { key: await this.collectShares(collectionId, undefined), collectionId };
      }
      step(`Creating collection key for ${schemaId} / ${epoch} (2-of-3)…`);
      const key = aead.newKey();
      try {
        const deviceShare = await this.storeShares(collectionId, key, untilMs);
        c = { collectionId, schemaId, epoch, deviceShare, expiresAtMs: untilMs, status: "live" };
        await this.vault.saveCollection(c);
        return { key, collectionId };
      } catch (e) {
        if (!(e instanceof Error && /already stored/.test(e.message))) throw e;
        // created earlier from another device (or before recovery): use the guardians' copy
        const existing = await this.collectShares(collectionId, undefined);
        await this.vault.saveCollection({ collectionId, schemaId, epoch, expiresAtMs: untilMs, status: "live" });
        await this.extendGuardians([{ recordId: collectionId, expiresAt: untilMs }]);
        return { key: existing, collectionId };
      }
    }
    if (untilMs !== undefined && untilMs > c.expiresAtMs) {
      await this.extendGuardians([{ recordId: collectionId, expiresAt: untilMs }]);
      c.expiresAtMs = untilMs;
      await this.vault.saveCollection(c);
    }
    return { key: await this.collectShares(collectionId, c.deviceShare), collectionId };
  }

  private async extendGuardians(items: { recordId: string; expiresAt: number }[]) {
    await Promise.all(this.cfg.guardians.map((g) => g.extend(this.vault, items)));
  }

  private async contentKeyFor(r: VaultRecord, log: Step = noop) {
    const dek = await this.collectShares(r.recordId, r.deviceShare, log);
    const col = await this.vault.getCollection(r.collectionId);
    const ck = await this.collectShares(r.collectionId, col?.deviceShare, log);
    const k = contentKey(dek, ck);
    zeroize(dek, ck);
    return k;
  }

  // ================================================================== put
  async put(input: PutInput, step: Step = noop): Promise<PutResult> {
    return (await this.putMany([input], step))[0];
  }

  /**
   * Relational insert: several records in ONE atomic Arkiv transaction (all or nothing).
   * A record may reference parents already in the vault (entity key) or earlier rows of the same batch
   * ({ index }). Referential rules enforced here, because Arkiv itself has no foreign keys:
   *  - every parent must be live;
   *  - a child never outlives its parents: its expiry is clamped to the earliest parent expiry;
   *  - at most 2 parents (2 = junction row for many-to-many).
   */
  async putMany(inputs: PutInput[], step: Step = noop): Promise<PutResult[]> {
    if (inputs.length === 0) throw new Error("nothing to write");
    if (inputs.length > MAX_BATCH_CREATES) throw new Error(`at most ${MAX_BATCH_CREATES} records per transaction`);
    const now = await this.publicClient.getBlockNumber();

    // ---- validate + resolve relations and absolute expiries (no secrets created yet)
    type Rel = { relation: string; existing?: VaultRecord; index?: number };
    const plans = await Promise.all(inputs.map(async (input, i) => {
      const fields = Object.keys(input.values);
      if (fields.length === 0 || fields.length > SLOTS) throw new Error(`a record needs 1..${SLOTS} fields`);
      const searchable = input.searchable ?? [];
      if (searchable.length > MAX_SEARCHABLE || searchable.some((f) => !fields.includes(f))) throw new Error(`up to ${MAX_SEARCHABLE} searchable fields, all present in values`);
      if (input.rangeField) {
        const v = input.values[input.rangeField];
        if (typeof v !== "number") throw new Error("rangeField must name a numeric field");
        rangePath(v); // validates 0..255 integer
      }
      const blocks = Math.ceil(input.retentionSeconds / BLOCK_SECONDS);
      if (blocks < 30 || BigInt(blocks) > MAX_LIFETIME) throw new Error("retention must be between 1 minute and ~182 days");
      const refs = [...(input.parent ? [{ key: input.parent }] : []), ...(input.parents ?? [])];
      if (refs.length > 2) throw new Error("at most 2 parents per record (2 = many-to-many junction row)");
      const rels: Rel[] = [];
      for (const ref of refs) {
        const relation = ref.relation ?? "child";
        if (typeof ref.key === "object") {
          if (!(ref.key.index >= 0 && ref.key.index < i)) throw new Error(`row ${i}: a batch parent must be an earlier row`);
          rels.push({ relation, index: ref.key.index });
        } else {
          const p = await this.requireRecord(ref.key);
          if (p.status !== "live") throw new Error(`parent ${ref.key} is not live`);
          rels.push({ relation, existing: p });
        }
      }
      return { input, fields, searchable, rels, target: now + BigInt(blocks) };
    }));
    for (const p of plans) { // clamp to parents (earlier rows already clamped, so this is transitive)
      for (const r of p.rels) {
        const parentExp = r.existing ? BigInt(r.existing.expiresAtBlock) : plans[r.index!].target;
        if (parentExp < p.target) p.target = parentExp;
      }
      if (p.target < now + 30n) throw new Error("a parent expires in under a minute: renew it before adding children");
    }
    const msOf = (target: bigint) => Date.now() + Number(target - now) * BLOCK_SECONDS * 1000;

    // ---- per record: keys, commitment, ciphertext, guardian shares
    const signerKey = this.mode === "ephemeral" ? (generatePrivateKey() as Hex) : undefined;
    const prepared: { recordId: Hex; fields: string[]; commitment: string; collectionId: Hex; epoch: string; deviceShare: string; swarmRef?: string; values: Record<string, unknown> }[] = [];
    const secrets: Uint8Array[] = [];
    const epoch = epochOf();
    const recordIds = plans.map(() => toHex(randomBytes(16)) as Hex);
    try {
      for (const [i, p] of plans.entries()) {
        const { input } = p;
        const tag = inputs.length > 1 ? `[${i + 1}/${inputs.length}] ` : "";
        const recordId = recordIds[i];
        const keyExpiresAt = msOf(p.target) + 60_000;
        const salt = randomFieldSalt();
        const { key: ck, collectionId } = await this.collectionKey(input.schemaId, epoch, keyExpiresAt, step);
        const dek = aead.newKey();
        const ckey = contentKey(dek, ck);
        secrets.push(dek, ckey);
        zeroize(ck);
        step(`${tag}Committing fields (Poseidon2)…`);
        const commitment = fieldHex(await computeCommitment(toSlots(p.fields, input.values), salt));
        let attachment: RecordPlaintext["attachment"];
        if (input.attachment) {
          if (!this.cfg.blobs) throw new Error("no blob store configured for attachments");
          step(`${tag}Encrypting attachment and uploading to ${this.cfg.blobs.name}…`);
          const sealed = aead.seal(attachmentKey(ckey), padPow2(input.attachment.bytes), attachmentAad(recordId));
          attachment = { name: input.attachment.name, type: input.attachment.type, swarmRef: await this.cfg.blobs.upload(sealed), size: input.attachment.bytes.length };
        }
        const parentIds = p.rels.map((r) => ({ recordId: r.existing ? r.existing.recordId : recordIds[r.index!], relation: r.relation }));
        step(`${tag}Encrypting record (AES-256-GCM, padded)…`);
        const plaintext: RecordPlaintext = {
          v: 1, schemaId: input.schemaId, recordId, fields: p.fields, values: input.values, salt: salt.toString(), createdAt: Date.now(), attachment,
          ...(parentIds.length ? { parents: parentIds } : {}),
        };
        const ct = aead.seal(ckey, pad(encodeRecord(plaintext)), recordAad(input.schemaId, recordId));
        step(`${tag}Splitting record key 2-of-3, shares to guardians (ML-KEM-768 + X25519)…`);
        const deviceShare = await this.storeShares(recordId, dek, keyExpiresAt);

        const tags: Record<string, string> = {};
        p.searchable.forEach((f, j) => { tags[`bix${j}`] = this.vault.blindTag(input.schemaId, epoch, f, input.values[f] as string | number | boolean); });
        if (input.rangeField) for (const n of rangePath(input.values[input.rangeField] as number)) tags[`r${n.level}`] = this.vault.rangeTag(input.schemaId, epoch, input.rangeField, n.level, n.prefix);
        parentIds.forEach((pp, j) => { tags[j === 0 ? "rel" : "rel2"] = this.vault.relTag(pp.recordId, pp.relation); });

        prepared.push({
          recordId, fields: p.fields, commitment, collectionId, epoch, deviceShare, swarmRef: attachment?.swarmRef,
          values: {
            app: APP, schemaId: input.schemaId, epoch, commitment, ct,
            envId: this.vault.sealEnvelope({ recordId, signerKey }),
            ...(attachment ? { swarmRef: attachment.swarmRef } : {}),
            ...tags,
          },
        });
      }

      // ---- one atomic Arkiv transaction for every row
      step(this.mode === "ephemeral"
        ? "Funding one-time signer via relayer, writing to Arkiv…"
        : inputs.length > 1 ? `Writing ${inputs.length} encrypted entities in ONE Arkiv transaction (confirm in wallet)…` : "Writing encrypted entity to Arkiv (confirm in wallet)…");
      const env = this.envFor(this.mode, signerKey);
      let res;
      try {
        res = await guardedBatch(env, {
          creates: prepared.map((r, i) => ({
            schema: ZkRecord, values: r.values,
            expiration: ExpirationTime.atBlock(plans[i].target),
            flags: { readonly: true, permissionlessExtension: false },
            salt: BigInt(toHex(randomBytes(15))),
          })) as any,
        });
      } catch (e) {
        await this.guardianShred(recordIds, "user").catch(() => {});
        throw e;
      }
      const keys = (res.createdEntities as string[]).map((k) => k.toLowerCase() as Hex);
      if (keys.length !== prepared.length) throw new ArkivWriteError("create count mismatch: reconcile before retrying", res.txHash);
      const live = await liveKeys(this.publicClient, keys);
      const blockNow = await this.publicClient.getBlockNumber();
      const guardianKeys = await Promise.all(this.cfg.guardians.map(async (g) => (await g.info()).signPublicKey));
      const out: PutResult[] = [];
      for (const [i, r] of prepared.entries()) {
        const exp = live.get(keys[i]) ?? plans[i].target;
        const parents = plans[i].rels.map((rel) => ({
          entityKey: (rel.existing ? rel.existing.entityKey : keys[rel.index!]) as Hex,
          recordId: rel.existing ? rel.existing.recordId : recordIds[rel.index!], relation: rel.relation,
        }));
        await this.vault.saveRecord({
          entityKey: keys[i], recordId: r.recordId, schemaId: inputs[i].schemaId, fields: r.fields, commitment: r.commitment, createdAt: Date.now(),
          expiresAtBlock: exp.toString(), expiresAtMs: this.msAt(exp, blockNow),
          swarmRef: r.swarmRef, guardians: guardianKeys, deviceShare: r.deviceShare, status: "live", proofKeys: [],
          collectionId: r.collectionId, epoch: r.epoch, signer: this.mode, signerKey,
          ...(parents.length ? { parents } : {}), ...(inputs[i].rangeField ? { rangeField: inputs[i].rangeField } : {}),
        });
        out.push({ entityKey: keys[i], txHash: res.txHash as Hex, expiresAtBlock: exp, commitment: r.commitment, swarmRef: r.swarmRef, signer: env.account });
      }
      step("Done");
      return out;
    } finally {
      zeroize(...secrets);
    }
  }


  private async requireRecord(entityKey: string) {
    const r = await this.vault.getRecord(entityKey);
    if (!r) throw new Error("record not in this vault (use recovery to import it)");
    return r;
  }

  // ================================================================== get
  async get(entityKey: string): Promise<{ record: RecordPlaintext; attachment?: Uint8Array }> {
    const r = await this.requireRecord(entityKey);
    if (r.status === "shredded") throw new Error("record was shredded");
    const entity = await this.publicClient.getEntity(entityKey as Hex, ZkRecord);
    const ckey = await this.contentKeyFor(r);
    try {
      const record = decodeRecord(unpad(aead.open(ckey, fromHex(entity.ct.value), recordAad(r.schemaId, r.recordId))));
      if (record.recordId !== r.recordId) throw new Error("record id mismatch");
      let attachment: Uint8Array | undefined;
      if (record.attachment && this.cfg.blobs) {
        const sealed = await this.cfg.blobs.download(record.attachment.swarmRef);
        attachment = unpadPow2(aead.open(attachmentKey(ckey), sealed, attachmentAad(r.recordId)));
      }
      return { record, attachment };
    } finally {
      zeroize(ckey);
    }
  }

  // ================================================================== list (+ expiry erasure)
  async list(): Promise<VaultRecord[]> {
    const recs = await this.vault.listRecords();
    const now = Date.now();
    for (const r of recs) {
      if (r.status === "live" && r.expiresAtMs <= now) {
        r.status = "expired";
        await this.vault.forgetSecrets(r.entityKey, { status: "expired" });
      }
    }
    return recs;
  }

  // ================================================================== blind-index search
  /**
   * Exact-match search over encrypted fields. Arkiv sees only HMAC tags; one OR query per chunk
   * covers 3 tag columns x E epochs. Returns entity keys of matching records owned by this vault.
   */
  async search(schemaId: string, field: string, value: string | number | boolean, epochs?: string[]) {
    const eps = epochs ?? (await this.epochsOf(schemaId));
    const tags = eps.map((e) => this.vault.blindTag(schemaId, e, field, value));
    const terms = tags.flatMap((t) => [eq("bix0", t), eq("bix1", t), eq("bix2", t)]);
    const { keys, queries } = await this.keysWhere(schemaId, terms);
    return { keys, queries, tagsTried: tags.length };
  }

  /**
   * Range search over an encrypted numeric field (0..255) that was written with `rangeField`.
   * [min, max] -> canonical tree cover (<= 14 nodes) per epoch -> equality terms on r1..r8.
   * Arkiv evaluates it server-side; it never sees the value or the bounds, only HMAC tags.
   */
  async searchRange(schemaId: string, field: string, min: number, max: number, epochs?: string[]) {
    const eps = epochs ?? (await this.epochsOf(schemaId));
    const cover = rangeCover(min, max);
    if (cover === "all") {
      const { keys, queries } = await this.keysWhere(schemaId, eps.map((e) => eq("epoch", e)));
      return { keys, queries, terms: eps.length, nodes: 0 };
    }
    const terms = eps.flatMap((e) => cover.map((n) => eq(`r${n.level}` as "r1", this.vault.rangeTag(schemaId, e, field, n.level, n.prefix))));
    const { keys, queries } = await this.keysWhere(schemaId, terms);
    return { keys, queries, terms: terms.length, nodes: cover.length };
  }

  /**
   * Encrypted COUNT: Arkiv counts matching entities server-side (no rows downloaded).
   * where = exact value (blind index) or a range (range index).
   */
  async count(schemaId: string, field: string, where: { eq: string | number | boolean } | { min: number; max: number }, epochs?: string[]) {
    const eps = epochs ?? (await this.epochsOf(schemaId));
    let terms: any[];
    if ("eq" in where) terms = eps.flatMap((e) => { const t = this.vault.blindTag(schemaId, e, field, where.eq); return [eq("bix0", t), eq("bix1", t), eq("bix2", t)]; });
    else {
      const cover = rangeCover(where.min, where.max);
      if (cover === "all") terms = eps.map((e) => eq("epoch", e));
      else terms = eps.flatMap((e) => cover.map((n) => eq(`r${n.level}` as "r1", this.vault.rangeTag(schemaId, e, field, n.level, n.prefix))));
    }
    let total = 0n, queries = 0;
    for (let i = 0; i < terms.length; i += TERMS_PER_QUERY) {
      total += await (this.publicClient.count().from(ZkRecord) as any).where((and as any)(eq("app", APP), eq("schemaId", schemaId), or(...terms.slice(i, i + TERMS_PER_QUERY))) as any).fetch();
      queries++;
    }
    return { count: Number(total), queries, terms: terms.length };
  }

  // ================================================================== relational layer
  /** JOIN parent -> children (rel OR rel2 = HMAC(relation, parent)): one indexed query + keyset pages. */
  async childrenOf(parentEntityKey: string, relation = "child") {
    const m = await this.childrenOfMany([parentEntityKey], relation);
    return { keys: m.byParent.get(parentEntityKey.toLowerCase() as Hex) ?? [], queries: m.queries };
  }

  /**
   * Batched JOIN for many parents (kills the N+1 pattern): 2 terms per parent, 9 parents per OR query.
   * Returns parent -> children map. Before: P queries; after: ceil(P/9) (+ pages).
   */
  async childrenOfMany(parentEntityKeys: string[], relation = "child") {
    const parents = await Promise.all(parentEntityKeys.map((k) => this.requireRecord(k)));
    const tagToParent = new Map(parents.map((p) => [this.vault.relTag(p.recordId, relation), p.entityKey.toLowerCase() as Hex]));
    const tags = [...tagToParent.keys()];
    const byParent = new Map<Hex, Hex[]>(parents.map((p) => [p.entityKey.toLowerCase() as Hex, []]));
    let queries = 0;
    for (let i = 0; i < tags.length; i += TERMS_PER_QUERY / 2) {
      const chunk = tags.slice(i, i + TERMS_PER_QUERY / 2);
      let cursor: string | undefined;
      for (;;) {
        const page: any = await (this.publicClient.select({ $key: true, rel: true, rel2: true }).from(ZkRecord) as any)
          .where((and as any)(eq("app", APP), or(...chunk.flatMap((t) => [eq("rel", t), eq("rel2", t)])), ...(cursor ? [gt("$key", key(cursor as Hex))] : [])))
          .orderBy(asc("$key")).limit(100).fetch();
        queries++;
        for (const e of page.entities) {
          for (const col of ["rel", "rel2"]) {
            const parent = tagToParent.get(e[col]?.value);
            if (parent) byParent.get(parent)!.push(e.$key.toLowerCase());
          }
        }
        if (page.entities.length < 100) break;
        cursor = page.entities[page.entities.length - 1].$key;
      }
    }
    return { byParent, queries };
  }

  /** belongsTo: the parents of a record (from the sealed vault, restored from ciphertext on recovery). O(1), no query. */
  async parentsOf(entityKey: string) {
    return (await this.requireRecord(entityKey)).parents ?? [];
  }

  /**
   * Many-to-many through junction rows: records linked to `entityKey` via junctions of `relation`.
   * e.g. patient -[visit]- doctor: linked(patient, "visit") -> doctors. 1 query + O(k) local lookups.
   */
  async linked(entityKey: string, relation: string) {
    const { keys: junctions, queries } = await this.childrenOf(entityKey, relation);
    const me = entityKey.toLowerCase();
    const out: { junction: Hex; other: Hex; relation: string }[] = [];
    for (const j of junctions) {
      const r = await this.vault.getRecord(j);
      for (const p of r?.parents ?? []) if (p.entityKey.toLowerCase() !== me) out.push({ junction: j, other: p.entityKey, relation: p.relation });
    }
    return { links: out, queries };
  }

  /** Dangling references: live records whose parent is gone (deleted/expired/shredded). ceil(P/20) queries. */
  async orphans() {
    const recs = (await this.vault.listRecords()).filter((r) => r.status === "live" && r.parents?.length);
    const live = await liveKeys(this.publicClient, recs.flatMap((r) => r.parents!.map((p) => p.entityKey)));
    return recs.filter((r) => r.parents!.some((p) => !live.has(p.entityKey.toLowerCase()))).map((r) => r.entityKey);
  }

  /** All descendants (BFS over blind FKs, every relation the vault knows about), depth <= 8. One batched query per level. */
  async descendantsOf(roots: string[]): Promise<Hex[]> {
    const all = await this.vault.listRecords();
    const seen = new Set(roots.map((k) => k.toLowerCase()));
    let frontier = [...seen];
    for (let depth = 0; depth < 8 && frontier.length; depth++) {
      // children are found locally first (vault knows parents), then confirmed on Arkiv via the blind FK
      const next = all.filter((r) => r.status === "live" && !seen.has(r.entityKey.toLowerCase()) && r.parents?.some((p) => frontier.includes(p.entityKey.toLowerCase())));
      const relations = [...new Set(next.flatMap((r) => r.parents!.map((p) => p.relation)))];
      const confirmed = new Set<string>();
      for (const rel of relations) {
        const { byParent } = await this.childrenOfMany(frontier.filter((k) => all.some((r) => r.entityKey.toLowerCase() === k && r.status === "live")), rel);
        for (const ks of byParent.values()) ks.forEach((k) => confirmed.add(k));
      }
      frontier = next.map((r) => r.entityKey.toLowerCase()).filter((k) => confirmed.has(k));
      frontier.forEach((k) => seen.add(k));
    }
    return [...seen] as Hex[];
  }

  private async epochsOf(schemaId: string) {
    return [...new Set([epochOf(), ...(await this.vault.listCollections()).filter((c) => c.schemaId === schemaId).map((c) => c.epoch)])];
  }

  /** OR of equality terms, chunked under the node's query-size limit, keyset-paginated per chunk. */
  private async keysWhere(schemaId: string, terms: any[]) {
    const keys = new Set<Hex>();
    let queries = 0;
    for (let i = 0; i < terms.length; i += TERMS_PER_QUERY) {
      let cursor: string | undefined;
      for (;;) {
        const res: any = await (this.publicClient.select({ $key: true }).from(ZkRecord) as any)
          .where((and as any)(eq("app", APP), eq("schemaId", schemaId), or(...terms.slice(i, i + TERMS_PER_QUERY)), ...(cursor ? [gt("$key", key(cursor as Hex))] : [])) as any)
          .orderBy(asc("$key")).limit(100).fetch();
        queries++;
        for (const e of res.entities) keys.add(e.$key.toLowerCase() as Hex);
        if (res.entities.length < 100) break;
        cursor = res.entities[res.entities.length - 1].$key;
      }
    }
    return { keys: [...keys], queries };
  }

  // ================================================================== prove
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
    const vkExists = await this.publicClient.select({ $key: true }).from(ZkVerificationKey).where(and(eq("app", APP), eq("vkHash", vkh))).limit(1).fetch();
    const recEntity = await this.publicClient.getEntity(key, ZkRecord);
    step("Publishing proof to Arkiv…");
    const res = await guardedBatch(this.envFor(r.signer, r.signerKey), {
      creates: [
        {
          schema: ZkProof,
          values: {
            app: APP, recordKey: key, circuitId: RANGE_CIRCUIT_ID, vkHash: vkh, audience: audienceFor(verifierNonce),
            claim: label.slice(0, 120), statement: utf8(JSON.stringify(statement)), proof: p.proof,
          },
          expiration: ExpirationTime.atBlock(recEntity.$expiresAt), // a proof never outlives its record
          flags: { readonly: true, permissionlessExtension: false },
        },
        ...(vkExists.entities.length === 0
          ? [{ schema: ZkVerificationKey, values: { app: APP, circuitId: RANGE_CIRCUIT_ID, vkHash: vkh, vk }, expiration: ExpirationTime.max(), flags: { readonly: true, permissionlessExtension: true } }]
          : []),
      ] as any,
    });
    const proofEntityKey = (res.createdEntities[0] as string).toLowerCase() as Hex;
    await this.vault.saveRecord({ ...r, proofKeys: [...r.proofKeys, proofEntityKey] });
    return { proofEntityKey, txHash: res.txHash as Hex, statementText: label, proveMs };
  }

  // ================================================================== shred
  private async guardianShred(ids: string[], reason: "user" | "account" | "expiry") {
    const req = buildShredRequest(this.vault, ids, reason);
    const settled = await Promise.allSettled(this.cfg.guardians.map((g) => g.shred(req)));
    return { req, settled };
  }

  /** Destroy keys for `ids` on both guardians (one request each, in parallel) and locally. */
  private async destroyKeys(ids: string[], reason: "user" | "account", onStep: StepFn) {
    const { req, settled } = await this.guardianShred(ids, reason);
    const attestations: DestroyedAttestation[] = [];
    settled.forEach((s, i) => {
      const id = `guardian-${i + 1}`;
      if (s.status === "fulfilled") { attestations.push(s.value); onStep(id, "done", `${s.value.guardianName} signed destruction of ${ids.length} key(s)`); }
      else onStep(id, "error", String((s.reason as Error)?.message ?? s.reason));
    });
    if (attestations.length === 0) throw new Error("no guardian confirmed destruction - nothing was changed, try again");
    return { req, attestations };
  }

  private async markPending(recs: VaultRecord[], req: ShredRequest, attestations: DestroyedAttestation[], level: ShredLevel) {
    const liveAll = await liveKeys(this.publicClient, recs.flatMap((r) => [r.entityKey, ...r.proofKeys]));
    for (const r of recs) {
      const live = [r.entityKey, ...r.proofKeys].filter((k) => liveAll.has(k.toLowerCase())) as Hex[];
      const fresh = (await this.vault.getRecord(r.entityKey))!;
      delete fresh.deviceShare; // key share gone; signerKey kept until the Arkiv cleanup succeeds
      await this.vault.saveRecord({ ...fresh, status: "shredded", pendingShred: { request: req, attestations, liveEntities: live, level } as any });
    }
  }

  /** Record-level crypto-shred. */
  async shred(entityKeys: string[], onStep: StepFn = () => {}, opts: { cascade?: boolean } = {}): Promise<ShredResult> {
    if (opts.cascade) entityKeys = await this.descendantsOf(entityKeys);
    const recs: VaultRecord[] = [];
    for (const k of entityKeys) {
      const r = await this.requireRecord(k);
      if (r.status === "shredded" && !r.pendingShred) throw new Error(`${k} is already shredded`);
      recs.push(r);
    }
    const fresh = recs.filter((r) => !r.pendingShred);
    let keysDestroyed = 0;
    if (fresh.length) {
      const { req, attestations } = await this.destroyKeys(fresh.map((r) => r.recordId), "user", onStep);
      onStep("device", "running");
      await this.markPending(fresh, req, attestations, "record");
      keysDestroyed = fresh.length;
      onStep("device", "done", "device shares erased");
    }
    const out = await this.publishShredReceipts(recs.map((r) => r.entityKey), onStep);
    return { ...out, keysDestroyed };
  }

  /**
   * Collection / epoch shred: destroy the collection key(s). Every record in them dies at once —
   * including records this device doesn't know about — with O(#collections) key operations.
   */
  async shredCollections(collections: { schemaId: string; epoch: string }[], level: "collection" | "epoch", onStep: StepFn = () => {}): Promise<ShredResult> {
    const ids = collections.map((c) => this.vault.collectionId(c.schemaId, c.epoch));
    const all = await this.vault.listRecords();
    const recs = all.filter((r) => ids.includes(r.collectionId) && r.status !== "shredded");
    // one guardian request: collection keys + (for hygiene) the record keys we know about
    const { req, attestations } = await this.destroyKeys([...ids, ...recs.map((r) => r.recordId)], "user", onStep);
    onStep("device", "running");
    for (const id of ids) {
      const c = await this.vault.getCollection(id);
      const [schemaId, epoch] = c ? [c.schemaId, c.epoch] : [collections[ids.indexOf(id)].schemaId, collections[ids.indexOf(id)].epoch];
      await this.vault.saveCollection({ collectionId: id, schemaId, epoch, expiresAtMs: c?.expiresAtMs ?? 0, status: "shredded" });
    }
    await this.markPending(recs, req, attestations, level);
    onStep("device", "done", `${ids.length} collection key(s) + ${recs.length} record key(s) erased`);
    if (recs.length === 0) { onStep("arkiv", "done", "no known live entities to clean up"); return { txHashes: [], receipts: [], deleted: [], level, keysDestroyed: ids.length }; }
    const out = await this.publishShredReceipts(recs.map((r) => r.entityKey), onStep);
    return { ...out, level, keysDestroyed: ids.length + recs.length };
  }

  async shredEpoch(epoch: string, onStep: StepFn = () => {}) {
    const cols = (await this.vault.listCollections()).filter((c) => c.epoch === epoch && c.status === "live");
    if (cols.length === 0) throw new Error(`no live collections for ${epoch}`);
    return this.shredCollections(cols, "epoch", onStep);
  }

  /** Account-level: every collection + record key, then the vault identity itself (envSecret, controller key). */
  async shredAccount(onStep: StepFn = () => {}) {
    const cols = (await this.vault.listCollections()).filter((c) => c.status === "live");
    const res = cols.length ? await this.shredCollections(cols, "epoch", onStep) : { txHashes: [], receipts: [], deleted: [], level: "account" as const, keysDestroyed: 0 };
    await this.vault.destroyIdentity();
    onStep("identity", "done", "controller key + envelope secret destroyed");
    return { ...res, level: "account" as const };
  }

  /** Arkiv part of a shred, safe to retry: delete live entities + publish receipts, one tx per owner, owners in parallel. */
  async publishShredReceipts(entityKeys: string[], onStep: StepFn = () => {}) {
    const recs = (await Promise.all(entityKeys.map((k) => this.vault.getRecord(k)))).filter((r): r is VaultRecord => !!r?.pendingShred);
    if (recs.length === 0) throw new Error("nothing pending");
    onStep("arkiv", "running", "deleting entities + publishing receipts");
    const stillLive = await liveKeys(this.publicClient, recs.flatMap((r) => r.pendingShred!.liveEntities));
    const txHashes: Hex[] = [], receipts: Hex[] = [], deleted: Hex[] = [];
    try {
      await this.perSigner(recs, (group) => ({
        deletes: group.flatMap((r) => r.pendingShred!.liveEntities).filter((k) => stillLive.has(k.toLowerCase())).map((k) => ({ entityKey: k as Hex })),
        creates: group.map((r) => ({
          schema: ShredReceipt,
          values: {
            app: APP, recordKey: r.entityKey, level: (r.pendingShred as any).level ?? "record", shreddedAt: u64(BigInt(Date.now())),
            request: utf8(JSON.stringify(r.pendingShred!.request)), attestations: utf8(JSON.stringify(r.pendingShred!.attestations)),
          },
          expiration: ExpirationTime.max(),
          flags: { readonly: true, permissionlessExtension: true },
        })) as any,
      }), async (r) => {
        txHashes.push(r.res.txHash as Hex);
        deleted.push(...(r.res.deletedEntities as Hex[]));
        for (let i = 0; i < r.group.length; i++) {
          const receiptKey = (r.res.createdEntities[i] as string).toLowerCase() as Hex;
          receipts.push(receiptKey);
          const { pendingShred, signerKey, ...rest } = r.group[i];
          await this.vault.saveRecord({ ...rest, status: "shredded", receiptKey, proofKeys: [] });
        }
      });
    } catch (e: any) {
      onStep("arkiv", "error", txHashes.length ? `${e.message} (${txHashes.length} tx already succeeded; retry publishes the rest)` : e.message);
      throw e;
    }
    onStep("arkiv", "done", `${txHashes.length} tx: ${txHashes.map((h) => h.slice(0, 10) + "…").join(", ")}`);
    return { txHashes, receipts, deleted, level: "record" as ShredLevel };
  }

  // ================================================================== recovery
  /** Find records on Arkiv that this vault's envSecret opens (wallet mode: by owner; ephemeral: full scan). */
  async recover(owner?: Hex, step: Step = noop) {
    const qp = new QueryPlanner(this.publicClient);
    const { rows, queries } = await qp.run({
      from: ZkRecord, where: { app: APP }, ...(owner && this.mode === "wallet" ? { ownedBy: owner } : {}),
      select: ["envId", "schemaId", "epoch", "commitment", "swarmRef", "$expiresAt", "$owner"],
    });
    step(`scanned ${rows.length} arkivzk records in ${queries} queries`);
    const now = await this.publicClient.getBlockNumber();
    const guardians = await Promise.all(this.cfg.guardians.map(async (g) => (await g.info()).signPublicKey));
    const found: Hex[] = [];
    for (const e of rows as any[]) {
      const env = this.vault.openEnvelope(fromHex(e.envId.value));
      if (!env || (await this.vault.getRecord(e.$key))) continue;
      const collectionId = this.vault.collectionId(e.schemaId.value, e.epoch.value);
      const r: VaultRecord = {
        entityKey: e.$key.toLowerCase(), recordId: env.recordId, schemaId: e.schemaId.value, fields: [], commitment: e.commitment.value,
        createdAt: Date.now(), expiresAtBlock: e.$expiresAt.toString(), expiresAtMs: this.msAt(e.$expiresAt, now),
        swarmRef: e.swarmRef?.value, guardians, status: "live", proofKeys: [], collectionId, epoch: e.epoch.value,
        signer: env.signerKey ? "ephemeral" : "wallet", signerKey: env.signerKey,
      };
      try {
        const full = await this.publicClient.getEntity(e.$key, ZkRecord);
        const ckey = await this.contentKeyFor(r);
        const rec = decodeRecord(unpad(aead.open(ckey, fromHex(full.ct.value), recordAad(r.schemaId, env.recordId))));
        zeroize(ckey);
        r.fields = rec.fields;
        r.createdAt = rec.createdAt;
        if (rec.parents?.length) (r as any)._parents = rec.parents;
        await this.vault.saveRecord(r);
        if (!(await this.vault.getCollection(collectionId)))
          await this.vault.saveCollection({ collectionId, schemaId: r.schemaId, epoch: r.epoch, expiresAtMs: r.expiresAtMs, status: "live" });
        found.push(r.entityKey);
        step(`recovered ${r.entityKey}`);
      } catch (err: any) {
        step(`skipped ${e.$key}: ${err.message}`);
      }
    }
    // relations: plaintext stores parent recordIds; map them to entity keys now that all rows are known
    const all = await this.vault.listRecords();
    const byRecordId = new Map(all.map((x) => [x.recordId, x.entityKey]));
    for (const x of all) {
      const ps = (x as any)._parents as { recordId: string; relation: string }[] | undefined;
      if (!ps) continue;
      delete (x as any)._parents;
      x.parents = ps.filter((p) => byRecordId.has(p.recordId as Hex)).map((p) => ({ ...p, entityKey: byRecordId.get(p.recordId as Hex)! }));
      await this.vault.saveRecord(x);
    }
    return found;
  }

  // ================================================================== "break it": decrypt archived calldata
  async tryDecryptCaptured(ct: Uint8Array, envId: Uint8Array, schemaId: string, epoch: string) {
    const log: string[] = [];
    const env = this.vault.openEnvelope(envId);
    if (!env) { log.push("envId does not open with this vault: not our record, or identity destroyed"); log.push("RESULT: undecryptable noise"); return { success: false, log }; }
    log.push(`envId opened -> recordId ${env.recordId.slice(0, 10)}…`);
    const local = (await this.vault.listRecords()).find((r) => r.recordId === env.recordId);
    const col = await this.vault.getCollection(this.vault.collectionId(schemaId, epoch));
    log.push(`record key: device share ${local?.deviceShare ? "present" : "absent"}; collection key: device share ${col?.deviceShare ? "present" : "absent"}${col?.status === "shredded" ? " (collection shredded)" : ""}`);
    let ckey: Uint8Array;
    try {
      const dek = await this.collectShares(env.recordId, local?.deviceShare, (m) => log.push(m));
      const ck = await this.collectShares(this.vault.collectionId(schemaId, epoch), col?.deviceShare, (m) => log.push(m));
      ckey = contentKey(dek, ck);
      zeroize(dek, ck);
    } catch (e: any) {
      log.push(e.message);
      log.push("RESULT: ciphertext is undecryptable noise");
      return { success: false, log };
    }
    try {
      const rec = decodeRecord(unpad(aead.open(ckey, ct, recordAad(schemaId, env.recordId))));
      log.push(`decrypted: ${JSON.stringify(rec.values)}`);
      return { success: true, log };
    } catch {
      log.push("keys reconstructed but AES-GCM authentication failed");
      return { success: false, log };
    } finally { zeroize(ckey); }
  }
}

export { GuardianError };
