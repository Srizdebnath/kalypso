/**
 * arkivzk guardian: holds ONE Shamir share per record, in RAM only (by default).
 * - shares arrive sealed with hybrid ML-KEM-768 + X25519 and leave sealed to the client's ephemeral key
 * - every request is signed by the record's controller (Ed25519)
 * - on shred it zeroizes and returns a signed destruction attestation
 * - a sweeper destroys shares whose retention expired, even if the user never comes back
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  fromHex, toHex, hpkeOpen, hpkeSeal, kemKeygen, signKeygen, signPayload, signPublicKey,
  verifyPayload, sha256Hex, canonicalJson, zeroize, randomBytes,
} from "@arkivzk/crypto";
import {
  DOMAIN, MAX_SKEW_MS,
  type DestroyedAttestationBody, type FetchShareRequest, type GuardianInfo, type PutShareRequest,
  type ShredRequest,
} from "@arkivzk/core";

const NAME = process.env.GUARDIAN_NAME ?? "guardian-1";
const PORT = Number(process.env.PORT ?? 7101);
const DATA_DIR = path.resolve(process.env.GUARDIAN_DATA_DIR ?? `./guardian-data/${NAME}`);
const PERSIST = process.env.GUARDIAN_PERSIST_SHARES === "1";
const MAX_BODY = 64 * 1024;

type Share = { share: Uint8Array; controller: string; expiresAt: number; storedAt: number };

// ---------- identity (persisted so attestations stay attributable across restarts) ----------
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const idFile = path.join(DATA_DIR, "identity.json");
let identity: { signSk: string; kemSeed: string };
if (fs.existsSync(idFile)) identity = JSON.parse(fs.readFileSync(idFile, "utf8"));
else {
  identity = { signSk: toHex(signKeygen().secretKey), kemSeed: toHex(randomBytes(32)) };
  fs.writeFileSync(idFile, JSON.stringify(identity), { mode: 0o600 });
}
const signSk = fromHex(identity.signSk);
const signPk = toHex(signPublicKey(signSk));
const kemKp = kemKeygen(fromHex(identity.kemSeed));
const kemPk = toHex(kemKp.publicKey);

// ---------- share store ----------
const shares = new Map<string, Share>();
const sharesDir = path.join(DATA_DIR, "shares");
if (PERSIST) {
  fs.mkdirSync(sharesDir, { recursive: true, mode: 0o700 });
  for (const f of fs.readdirSync(sharesDir)) {
    const s = JSON.parse(fs.readFileSync(path.join(sharesDir, f), "utf8"));
    shares.set(f.replace(/\.json$/, ""), { ...s, share: fromHex(s.share) });
  }
}

function persist(id: string, s: Share) {
  if (!PERSIST) return;
  const file = path.join(sharesDir, `${id}.json`);
  const fd = fs.openSync(file, "w", 0o600);
  fs.writeSync(fd, JSON.stringify({ ...s, share: toHex(s.share) }));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

function destroy(id: string): "destroyed" | "absent" {
  const s = shares.get(id);
  if (!s) return "absent";
  zeroize(s.share);
  shares.delete(id);
  if (PERSIST) {
    const file = path.join(sharesDir, `${id}.json`);
    if (fs.existsSync(file)) {
      // overwrite before unlink (best effort on journaling/SSD, documented in docs/04)
      const size = fs.statSync(file).size;
      const fd = fs.openSync(file, "r+");
      fs.writeSync(fd, randomBytes(size));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.unlinkSync(file);
    }
  }
  return "destroyed";
}

// ---------- replay protection ----------
const seenNonces = new Map<string, number>();
function fresh(ts: number, nonce?: string) {
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) throw new HttpError(400, "stale or future timestamp");
  if (nonce) {
    if (seenNonces.has(nonce)) throw new HttpError(409, "replayed nonce");
    seenNonces.set(nonce, now);
  }
}

// ---------- expiry sweeper: retention ends => keys die, user doesn't need to be online ----------
const expiryLog: { recordId: string; at: number }[] = [];
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of shares) if (s.expiresAt <= now) {
    destroy(id);
    expiryLog.push({ recordId: id, at: now });
    console.log(`[${NAME}] auto-shred on expiry ${id}`);
  }
  for (const [n, t] of seenNonces) if (now - t > 2 * MAX_SKEW_MS) seenNonces.delete(n);
  if (expiryLog.length > 1000) expiryLog.splice(0, expiryLog.length - 1000);
}, 10_000).unref();

// ---------- http ----------
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const isHex = (s: unknown, bytes?: number): s is string =>
  typeof s === "string" && /^0x[0-9a-fA-F]*$/.test(s) && (bytes === undefined || s.length === 2 + bytes * 2);
const isId = (s: unknown): s is string => isHex(s, 16);

function requireSig(pk: string, domain: string, body: object, sig: unknown) {
  if (!isHex(pk, 32) || !isHex(sig, 64) || !verifyPayload(fromHex(pk), domain, body, fromHex(sig as string)))
    throw new HttpError(401, "bad controller signature");
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "invalid json"); }
}

const routes: Record<string, (body: any) => unknown> = {
  "GET /info": (): GuardianInfo => ({
    name: NAME, signPublicKey: signPk, kemPublicKey: kemPk, version: 1, sharesHeld: shares.size,
    persistence: PERSIST ? "disk" : "ram",
  }),

  "GET /expired": () => ({ guardian: signPk, recent: expiryLog.slice(-100) }),

  "POST /shares": (b: PutShareRequest) => {
    if (!isId(b.recordId) || !isHex(b.sealedShare) || !Number.isFinite(b.expiresAt)) throw new HttpError(400, "bad request");
    fresh(b.ts);
    const signed = { recordId: b.recordId, controller: b.controller, sealedShareHash: sha256Hex(fromHex(b.sealedShare)), expiresAt: b.expiresAt, ts: b.ts };
    requireSig(b.controller, DOMAIN.put, signed, b.sig);
    if (shares.has(b.recordId)) throw new HttpError(409, "share already stored for this record");
    if (b.expiresAt <= Date.now()) throw new HttpError(400, "already expired");
    const share = hpkeOpen(kemKp.secretKey, fromHex(b.sealedShare), "share-put:" + b.recordId);
    const s: Share = { share, controller: b.controller, expiresAt: b.expiresAt, storedAt: Date.now() };
    shares.set(b.recordId, s);
    persist(b.recordId, s);
    const att = { guardian: signPk, recordId: b.recordId, expiresAt: b.expiresAt, ts: Date.now() };
    return { ...att, sig: signPayload(signSk, DOMAIN.stored, att) };
  },

  "POST /shares/fetch": (b: FetchShareRequest) => {
    if (!isId(b.recordId) || !isHex(b.clientKemPk) || typeof b.nonce !== "string") throw new HttpError(400, "bad request");
    const s = shares.get(b.recordId);
    if (!s) throw new HttpError(404, "no share (never stored, expired or shredded)");
    requireSig(s.controller, DOMAIN.fetch, { recordId: b.recordId, clientKemPk: b.clientKemPk, nonce: b.nonce, ts: b.ts }, b.sig);
    fresh(b.ts, b.nonce);
    return { sealedShare: toHex(hpkeSeal(fromHex(b.clientKemPk), s.share, "share-get:" + b.recordId)) };
  },

  "POST /shred": (b: ShredRequest) => {
    if (!Array.isArray(b.recordIds) || b.recordIds.length === 0 || b.recordIds.length > 256 || !b.recordIds.every(isId))
      throw new HttpError(400, "bad request");
    const { sig, ...body } = b;
    requireSig(b.controller, DOMAIN.shred, body, sig);
    fresh(b.ts, b.nonce);
    // only the controller that stored a share may destroy it
    for (const id of b.recordIds) {
      const s = shares.get(id);
      if (s && s.controller !== b.controller) throw new HttpError(403, `not controller of ${id}`);
    }
    const results = b.recordIds.map((recordId) => ({ recordId, status: destroy(recordId) }));
    const att: DestroyedAttestationBody = {
      guardian: signPk, guardianName: NAME, requestHash: sha256Hex(canonicalJson(b)), results, ts: Date.now(),
    };
    console.log(`[${NAME}] shred ${results.map((r) => `${r.recordId}:${r.status}`).join(", ")}`);
    return { ...att, sig: signPayload(signSk, DOMAIN.destroyed, att) };
  },
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const route = routes[`${req.method} ${(req.url ?? "").split("?")[0]}`];
  try {
    if (!route) throw new HttpError(404, "not found");
    const body = req.method === "POST" ? await readJson(req) : undefined;
    const out = route(body);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(`[${NAME}]`, e?.message);
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: e instanceof HttpError ? e.message : "internal error" }));
  }
});

server.listen(PORT, () => console.log(`[${NAME}] listening :${PORT} sign=${signPk.slice(0, 18)}… persistence=${PERSIST ? "disk" : "ram"}`));
