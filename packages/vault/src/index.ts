import {
  aead, fromHex, toHex, utf8, fromUtf8, hkdf, sha256, signKeygen, signPublicKey, signPayload,
  hpkeSeal, hpkeOpen, kemKeygen, randomBytes, zeroize, sha256Hex, verifyPayload, canonicalJson,
} from "@arkivzk/crypto";
import { scrypt } from "@noble/hashes/scrypt.js";
import {
  DOMAIN,
  type DestroyedAttestation, type GuardianInfo, type PutShareRequest, type ShredRequest,
  type ShredRequestBody, type StoredAttestation,
} from "@arkivzk/core";

// ------------------------------------------------------------------------------------------------
// Storage
// ------------------------------------------------------------------------------------------------

/** Minimal async key-value store. Browser: IndexedDB. Node: in-process map or your own. */
export interface KV {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

/** In-process store (Node services, scripts, tests). */
export class MemoryKV implements KV {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k); }
  async set(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
  async keys(p: string) { return [...this.m.keys()].filter((k) => k.startsWith(p)); }
}

/** IndexedDB-backed store (browser). */
export class IndexedDBKV implements KV {
  private dbp: Promise<IDBDatabase>;
  constructor(name = "arkivzk-vault") {
    this.dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbp;
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  get(k: string) { return this.tx<string | undefined>("readonly", (s) => s.get(k)); }
  async set(k: string, v: string) { await this.tx("readwrite", (s) => s.put(v, k)); }
  async delete(k: string) { await this.tx("readwrite", (s) => s.delete(k)); }
  async keys(p: string) {
    const all = (await this.tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())) as string[];
    return all.filter((k) => k.startsWith(p));
  }
}

/** Encrypts everything the vault keeps at rest. Browser: key from passkey PRF or a non-extractable WebCrypto key. */
export interface Sealer {
  seal(pt: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  open(ct: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

export function rawKeySealer(key: Uint8Array): Sealer {
  if (key.length !== 32) throw new Error("sealer key must be 32 bytes");
  return {
    seal: async (pt, aad) => aead.seal(key, pt, aad),
    open: async (ct, aad) => aead.open(key, ct, aad),
  };
}

/** Sealer backed by a non-extractable WebCrypto AES-GCM key (cannot be read out of the browser by JS). */
export function webCryptoSealer(key: CryptoKey): Sealer {
  return {
    async seal(pt, aad) {
      const iv = randomBytes(12);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource }, key, pt as BufferSource));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv);
      out.set(ct, 12);
      return out;
    },
    async open(ct, aad) {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ct.subarray(0, 12) as BufferSource, additionalData: aad as BufferSource }, key, ct.subarray(12) as BufferSource));
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Vault
// ------------------------------------------------------------------------------------------------

export type RecordStatus = "live" | "shredded" | "expired";

/** What the device remembers about a record. Sealed at rest. */
export type VaultRecord = {
  entityKey: `0x${string}`;
  recordId: `0x${string}`;
  schemaId: string;
  fields: string[];
  commitment: string;
  createdAt: number;
  expiresAtBlock: string;
  expiresAtMs: number;
  swarmRef?: string;
  guardians: string[]; // guardian sign public keys, same order as share index 1,2
  deviceShare?: string; // hex - deleted on shred
  status: RecordStatus;
  proofKeys: `0x${string}`[];
  receiptKey?: `0x${string}`;
};

type Identity = { controllerSk: string; envSecret: string; createdAt: number };

const AAD_ID = utf8("arkivzk.vault.identity.v1");
const aadRec = (k: string) => utf8("arkivzk.vault.record.v1|" + k);

export class Vault {
  private constructor(
    private kv: KV,
    private sealer: Sealer,
    private id: Identity,
  ) {}

  static async open(kv: KV, sealer: Sealer): Promise<Vault> {
    const stored = await kv.get("identity");
    if (stored) {
      const id = JSON.parse(fromUtf8(await sealer.open(fromHex(stored), AAD_ID))) as Identity;
      return new Vault(kv, sealer, id);
    }
    const id: Identity = {
      controllerSk: toHex(signKeygen().secretKey),
      envSecret: toHex(randomBytes(32)),
      createdAt: Date.now(),
    };
    await kv.set("identity", toHex(await sealer.seal(utf8(JSON.stringify(id)), AAD_ID)));
    return new Vault(kv, sealer, id);
  }

  get controller(): `0x${string}` {
    return toHex(signPublicKey(fromHex(this.id.controllerSk)));
  }

  sign(domain: string, payload: unknown) {
    return signPayload(fromHex(this.id.controllerSk), domain, payload);
  }

  // envId = AES-GCM(HKDF(envSecret), recordId): on-chain pointer only the owner can open.
  private envKey() {
    return hkdf(sha256, fromHex(this.id.envSecret), undefined, utf8("arkivzk/envid/v1"), 32);
  }
  sealEnvId(recordId: string): Uint8Array {
    return aead.seal(this.envKey(), fromHex(recordId), utf8("envid"));
  }
  openEnvId(envId: Uint8Array): `0x${string}` | null {
    try { return toHex(aead.open(this.envKey(), envId, utf8("envid"))); } catch { return null; }
  }

  async saveRecord(r: VaultRecord) {
    const k = r.entityKey.toLowerCase();
    await this.kv.set("rec:" + k, toHex(await this.sealer.seal(utf8(JSON.stringify(r)), aadRec(k))));
  }
  async getRecord(entityKey: string): Promise<VaultRecord | undefined> {
    const k = entityKey.toLowerCase();
    const v = await this.kv.get("rec:" + k);
    if (!v) return undefined;
    return JSON.parse(fromUtf8(await this.sealer.open(fromHex(v), aadRec(k))));
  }
  async listRecords(): Promise<VaultRecord[]> {
    const out: VaultRecord[] = [];
    for (const k of await this.kv.keys("rec:")) {
      const r = await this.getRecord(k.slice(4));
      if (r) out.push(r);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  /** Drop the device share and everything secret about a record; keep a tombstone for the UI. */
  async forgetSecrets(entityKey: string, patch: Partial<VaultRecord>) {
    const r = await this.getRecord(entityKey);
    if (!r) return;
    delete r.deviceShare;
    await this.saveRecord({ ...r, ...patch });
  }

  /** Account-level shred: wipe identity (controller key + envId secret) and all records. */
  async destroyIdentity() {
    for (const k of await this.kv.keys("rec:")) await this.kv.delete(k);
    await this.kv.delete("identity");
    this.id.controllerSk = "0x";
    this.id.envSecret = "0x";
  }

  // ---- recovery kit: controller key + envSecret, encrypted with a passphrase (scrypt N=2^17) ----
  exportRecoveryKit(passphrase: string): string {
    if (passphrase.length < 12) throw new Error("use a passphrase of at least 12 characters");
    const salt = randomBytes(16);
    const key = scrypt(utf8(passphrase), salt, { N: 2 ** 17, r: 8, p: 1, dkLen: 32 });
    const ct = aead.seal(key, utf8(JSON.stringify(this.id)), utf8("arkivzk.recovery.v1"));
    zeroize(key);
    return JSON.stringify({ v: 1, kdf: "scrypt-n17-r8-p1", salt: toHex(salt), ct: toHex(ct) });
  }

  static async importRecoveryKit(kv: KV, sealer: Sealer, kit: string, passphrase: string): Promise<Vault> {
    const k = JSON.parse(kit);
    if (k?.v !== 1) throw new Error("unknown recovery kit");
    const key = scrypt(utf8(passphrase), fromHex(k.salt), { N: 2 ** 17, r: 8, p: 1, dkLen: 32 });
    let id: Identity;
    try { id = JSON.parse(fromUtf8(aead.open(key, fromHex(k.ct), utf8("arkivzk.recovery.v1")))); }
    catch { throw new Error("wrong passphrase or corrupted kit"); }
    finally { zeroize(key); }
    await kv.set("identity", toHex(await sealer.seal(utf8(JSON.stringify(id)), AAD_ID)));
    return new Vault(kv, sealer, id);
  }
}

// ------------------------------------------------------------------------------------------------
// Guardian client
// ------------------------------------------------------------------------------------------------

export class GuardianError extends Error {}

export class GuardianClient {
  private infoCache?: GuardianInfo;
  constructor(readonly url: string) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url.replace(/\/$/, "") + path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GuardianError(`guardian ${this.url} unreachable`);
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new GuardianError(`guardian ${this.infoCache?.name ?? this.url}: ${j.error ?? res.status}`);
    return j as T;
  }

  async info(): Promise<GuardianInfo> {
    this.infoCache ??= await this.call<GuardianInfo>("GET", "/info");
    return this.infoCache;
  }

  async putShare(vault: Vault, recordId: string, share: Uint8Array, expiresAt: number): Promise<StoredAttestation> {
    const info = await this.info();
    const sealedShare = toHex(hpkeSeal(fromHex(info.kemPublicKey), share, "share-put:" + recordId));
    const ts = Date.now();
    const signed = { recordId, controller: vault.controller, sealedShareHash: sha256Hex(fromHex(sealedShare)), expiresAt, ts };
    const req: PutShareRequest = { recordId, controller: vault.controller, sealedShare, expiresAt, ts, sig: vault.sign(DOMAIN.put, signed) };
    const att = await this.call<StoredAttestation>("POST", "/shares", req);
    const { sig, ...body } = att;
    if (att.guardian !== info.signPublicKey || !verifyPayload(fromHex(info.signPublicKey), DOMAIN.stored, body, fromHex(sig)))
      throw new GuardianError("guardian returned an invalid storage attestation");
    return att;
  }

  async fetchShare(vault: Vault, recordId: string): Promise<Uint8Array> {
    const kp = kemKeygen();
    const ts = Date.now();
    const nonce = toHex(randomBytes(16));
    const clientKemPk = toHex(kp.publicKey);
    const sig = vault.sign(DOMAIN.fetch, { recordId, clientKemPk, nonce, ts });
    const { sealedShare } = await this.call<{ sealedShare: string }>("POST", "/shares/fetch", { recordId, clientKemPk, nonce, ts, sig });
    try {
      return hpkeOpen(kp.secretKey, fromHex(sealedShare), "share-get:" + recordId);
    } finally {
      zeroize(kp.secretKey);
    }
  }

  async shred(req: ShredRequest): Promise<DestroyedAttestation> {
    const info = await this.info();
    const att = await this.call<DestroyedAttestation>("POST", "/shred", req);
    if (!verifyDestroyedAttestation(att, req) || att.guardian !== info.signPublicKey)
      throw new GuardianError("guardian returned an invalid destruction attestation");
    return att;
  }
}

export function buildShredRequest(vault: Vault, recordIds: string[], reason: ShredRequestBody["reason"]): ShredRequest {
  const body: ShredRequestBody = { recordIds, controller: vault.controller, nonce: toHex(randomBytes(16)), ts: Date.now(), reason };
  return { ...body, sig: vault.sign(DOMAIN.shred, body) };
}

/** Anyone can run this: checks a guardian's signature and that it answers exactly this request. */
export function verifyDestroyedAttestation(att: DestroyedAttestation, req: ShredRequest): boolean {
  const { sig, ...body } = att;
  if (body.requestHash !== sha256Hex(canonicalJson(req))) return false;
  const ids = new Set(req.recordIds);
  if (body.results.length !== ids.size || !body.results.every((r) => ids.has(r.recordId))) return false;
  try { return verifyPayload(fromHex(body.guardian), DOMAIN.destroyed, body, fromHex(sig)); } catch { return false; }
}

export function verifyShredRequest(req: ShredRequest): boolean {
  const { sig, ...body } = req;
  try { return verifyPayload(fromHex(req.controller), DOMAIN.shred, body, fromHex(sig)); } catch { return false; }
}
