/**
 * arkivzk-client: the ONLY bridge between the web UI and the arkivzk library.
 * Runs in the browser. Heavy modules (SDK, ZK prover) are imported lazily on first use.
 */

export type FieldValue = number | string | boolean;
export type RecordStatus = "live" | "shredded" | "expired";
export type LocalRecord = {
  entityKey: `0x${string}`;
  schemaId: string;
  createdAt: number;
  expiresAtBlock: string;
  expiresAtMs: number | null;
  status: RecordStatus;
  swarmRef?: string;
  fieldNames: string[];
  /** Keys destroyed but the ShredReceipt was not published yet: offer a retry. */
  pendingShred?: boolean;
  /** "2026-11": the month collection this record belongs to */
  epoch: string;
  /** who owns the entity on Arkiv: the user's wallet, or a one-time key funded by the relayer */
  signer: "wallet" | "ephemeral";
};
export type SignerMode = "wallet" | "ephemeral";
export type CollectionView = { collectionId: string; schemaId: string; epoch: string; status: "live" | "shredded"; records: number };
export type PutInput = {
  schemaId: string;
  values: Record<string, FieldValue>;
  file?: File;
  retentionSeconds: number;
  /** up to 3 field names made exact-match searchable (blind index) */
  searchable?: string[];
};
export type PutResult = {
  entityKey: `0x${string}`;
  txHash: `0x${string}`;
  expiresAtBlock: string;
  commitment: string;
  swarmRef?: string;
};
export type DecryptedRecord = {
  values: Record<string, FieldValue>;
  file?: { name: string; type: string; bytes: Uint8Array };
};
export type Claim = { field: string; min?: number; max?: number; equals?: FieldValue };
export type ProveResult = {
  proofEntityKey: `0x${string}`;
  txHash: `0x${string}`;
  statementText: string;
  proveMs: number;
};
export type ShredStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
};
export type ShredReceiptView = {
  receiptKey: `0x${string}`;
  txHash: `0x${string}`;
  level: string;
  deletedEntities: string[];
  attestations: { guardian: string; publicKey: string; signature: string; valid: boolean }[];
  createdAt: number;
  /** Upper bound on key shares that could still exist anywhere after the shred. */
  keySharesRemainingAtMost: number;
};
export type VerifyResult = {
  valid: boolean;
  statementText: string;
  recordKey: string;
  recordStatus: RecordStatus;
  vkHash: string;
  reason?: string;
  checks: { name: string; ok: boolean; detail?: string }[];
  /** ShredReceipt for the record, if it has been shredded. */
  receiptKey?: string;
};
export type ArchiveItem = {
  txHash: string;
  blockNumber: string;
  capturedAt: number;
  bytes: number;
  entityKeys: string[];
  recordShredded: boolean;
};
export type DecryptAttempt = { success: boolean; log: string[] };
export type QueryPreset =
  | { kind: "myRecords" }
  | { kind: "proofsForMyRecords" }
  | { kind: "addressedTo"; nonce: string; claim?: string };


/* ================================================================ wiring */

import type { ArkivZK as ArkivZKType, VaultRecord, ReceiptView, QuerySpec } from "@arkivzk/sdk";
import type { EIP1193Provider } from "viem";

type Hex = `0x${string}`;
type Sdk = typeof import("@arkivzk/sdk");

const CHAIN_ID_HEX = "0x76edaf";
const PUBLIC_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";

let sdkP: Promise<Sdk> | null = null;
const sdk = () => (sdkP ??= import("@arkivzk/sdk"));

type AppConfig = { guardians: string[]; swarm: boolean; explorer: string };
let cfgP: Promise<AppConfig> | null = null;
const appConfig = () => (cfgP ??= fetch("/api/config").then((r) => r.json()));

let rpcId = 0;
async function rpc(args: { method: string; params?: unknown }): Promise<unknown> {
  const r = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: args.method, params: args.params ?? [] }),
  });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message ?? "RPC error"), { code: j.error.code, data: j.error.data });
  return j.result;
}

async function chain() {
  const { rabdi } = await import("@arkiv-network/sdk/chains");
  // chain metadata only; all reads go through /api/rpc
  const c = rabdi({ accessKey: "" });
  return { ...c, rpcUrls: { default: { http: [PUBLIC_RPC] } } } as unknown as typeof c;
}

let pcP: Promise<import("@arkiv-network/sdk").PublicArkivClient> | null = null;
async function publicClient() {
  return (pcP ??= (async () => {
    const { createPublicClient } = await import("@arkiv-network/sdk");
    const { custom } = await import("viem");
    return createPublicClient({ chain: await chain(), transport: custom({ request: rpc as never }), cacheTime: 0 });
  })());
}

function injected(): EIP1193Provider {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask (or another injected wallet) and reload.");
  return eth;
}

async function ensureRabdi(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw new Error("Please switch your wallet to Arkiv Rabdi (chain 7794095).");
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: CHAIN_ID_HEX, chainName: "Arkiv Rabdi", nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 },
        rpcUrls: [PUBLIC_RPC], blockExplorerUrls: ["https://rabdi.explorer.arkiv.network"],
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  }
  if (BigInt(await provider.request({ method: "eth_chainId" })) !== 7794095n) throw new Error("Wallet is not on Arkiv Rabdi");
}

// ---- device key: non-extractable AES-GCM CryptoKey kept in IndexedDB (JS can use it, never read it) ----
function idb<T>(op: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("arkivzk-device", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = op(open.result.transaction("keys", mode).objectStore("keys"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
async function deviceKey(address: string): Promise<CryptoKey> {
  const id = "device:" + address.toLowerCase();
  const existing = await idb<CryptoKey | undefined>((s) => s.get(id), "readonly");
  if (existing) return existing;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  // `add` fails if another tab/call stored a key first; then use that one. Never overwrite a device key:
  // the vault is sealed with it, and a replaced key makes the vault unreadable (OperationError).
  try {
    await idb((s) => s.add(k, id), "readwrite");
    return k;
  } catch {
    const winner = await idb<CryptoKey | undefined>((s) => s.get(id), "readonly");
    if (!winner) throw new Error("Could not store the device key in IndexedDB");
    return winner;
  }
}

type Session = { address: Hex; zk: ArkivZKType };
let session: Session | null = null;

async function buildZk(address: Hex, vaultOverride?: import("@arkivzk/sdk").Vault): Promise<ArkivZKType> {
  const s = await sdk();
  const cfg = await appConfig();
  if (cfg.guardians.length < 2) throw new Error("server config: two guardian URLs required");
  const vault = vaultOverride ?? await s.Vault.open(new s.IndexedDBKV("arkivzk-vault-" + address.toLowerCase()), s.webCryptoSealer(await deviceKey(address)));
  const pc = await publicClient();
  const mode = getSignerMode();
  const blobs = cfg.swarm ? (await import("@arkivzk/swarm")).httpBlobStore("/api/swarm") : undefined;
  return new s.ArkivZK({
    publicClient: pc,
    vault,
    guardians: [new s.GuardianClient(cfg.guardians[0]), new s.GuardianClient(cfg.guardians[1])],
    write: { chain: await chain(), rpc: rpc as never, publicClient: pc as never, provider: injected(), account: address },
    blobs,
    signer: mode,
    // always wired: records written in ephemeral mode still need the relayer for shred/renew after switching back to wallet mode
    relayer: s.httpRelayer("/api/relayer"),
  });
}

const MODE_KEY = "arkivzk-signer-mode";
export function getSignerMode(): SignerMode {
  try { return (localStorage.getItem(MODE_KEY) as SignerMode) === "ephemeral" ? "ephemeral" : "wallet"; } catch { return "wallet"; }
}
/** Switch signer mode for NEW records (existing records keep their owner). */
export async function setSignerMode(mode: SignerMode): Promise<void> {
  localStorage.setItem(MODE_KEY, mode);
  session = null; // rebuilt with the new mode on next use
}

let sessionP: Promise<Session> | null = null;

/** Single-flight: parallel callers (list + collections on page load) share one session build. */
async function requireSession(): Promise<Session> {
  if (session) {
    const [cur] = (await injected().request({ method: "eth_accounts" })) as Hex[];
    if (cur && cur.toLowerCase() === session.address.toLowerCase()) return session;
    session = null;
  }
  sessionP ??= (async () => {
    const acct = await currentAccount();
    if (!acct) throw new Error("Connect your wallet first.");
    await ensureRabdi(injected());
    let zk: ArkivZKType;
    try {
      zk = await buildZk(acct);
    } catch (e) {
      if (e instanceof Error && e.name === "OperationError")
        throw new Error("This browser's vault can't be unlocked with its device key (the key in IndexedDB was replaced). Restore from your recovery kit in Settings.");
      throw e;
    }
    session = { address: acct, zk };
    return session;
  })().finally(() => { sessionP = null; });
  return sessionP;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toLocal(r: VaultRecord): LocalRecord {
  return {
    entityKey: r.entityKey, schemaId: r.schemaId, createdAt: r.createdAt, expiresAtBlock: r.expiresAtBlock,
    expiresAtMs: r.expiresAtMs || null, status: r.status, swarmRef: r.swarmRef, fieldNames: r.fields,
    pendingShred: !!r.pendingShred,
    epoch: r.epoch, signer: r.signer,
  };
}

function receiptView(r: ReceiptView, txHash?: Hex, deleted?: string[]): ShredReceiptView {
  const validGuardians = new Set(r.attestations.filter((a) => a.valid).map((a) => a.guardian)).size;
  return {
    receiptKey: r.receiptKey as Hex,
    txHash: txHash ?? ("0x" as Hex),
    level: r.level,
    deletedEntities: deleted ?? [r.recordKey],
    attestations: r.attestations.map((a) => ({ guardian: a.guardianName, publicKey: a.guardian, signature: a.sig, valid: a.valid })),
    createdAt: r.shreddedAt,
    keySharesRemainingAtMost: Math.max(0, 3 - 1 - validGuardians),
  };
}

/* ================================================================ wallet */

export async function connectWallet(): Promise<{ address: `0x${string}` }> {
  const p = injected();
  const [address] = (await p.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!address) throw new Error("No account selected in wallet");
  await ensureRabdi(p);
  session = { address, zk: await buildZk(address) };
  return { address };
}

export async function currentAccount(): Promise<`0x${string}` | null> {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) return null;
  const [a] = (await eth.request({ method: "eth_accounts" })) as Hex[];
  return a ?? null;
}

/* ================================================================ records */

export async function putRecord(input: PutInput, onStep?: (s: string) => void): Promise<PutResult> {
  const { zk } = await requireSession();
  const attachment = input.file
    ? { name: input.file.name, type: input.file.type || "application/octet-stream", bytes: new Uint8Array(await input.file.arrayBuffer()) }
    : undefined;
  const r = await zk.put({ schemaId: input.schemaId, values: input.values, retentionSeconds: input.retentionSeconds, attachment, searchable: input.searchable }, onStep);
  return { entityKey: r.entityKey, txHash: r.txHash, expiresAtBlock: r.expiresAtBlock.toString(), commitment: r.commitment, swarmRef: r.swarmRef };
}

export async function listRecords(): Promise<LocalRecord[]> {
  const { zk } = await requireSession();
  return (await zk.list()).map(toLocal);
}

export async function getRecord(entityKey: string): Promise<DecryptedRecord> {
  const { zk } = await requireSession();
  const { record, attachment } = await zk.get(entityKey);
  return {
    values: record.values as Record<string, FieldValue>,
    file: record.attachment && attachment ? { name: record.attachment.name, type: record.attachment.type, bytes: attachment } : undefined,
  };
}

export async function proveClaim(entityKey: string, claim: Claim, verifierNonce: string, onStep?: (s: string) => void): Promise<ProveResult> {
  const { zk } = await requireSession();
  return zk.prove(entityKey, claim, verifierNonce, onStep);
}

/* ================================================================ shred */

const SHRED_STEPS: ShredStep[] = [
  { id: "guardian-1", label: "Guardian 1 destroys its key share", status: "pending" },
  { id: "guardian-2", label: "Guardian 2 destroys its key share", status: "pending" },
  { id: "device", label: "Device share erased from this browser", status: "pending" },
  { id: "arkiv", label: "One Arkiv tx: delete entities + publish receipt", status: "pending" },
];

function stepTracker(onStep: (steps: ShredStep[]) => void, skipKeys = false) {
  const steps = SHRED_STEPS.map((s) => ({ ...s, status: (skipKeys && s.id !== "arkiv" ? "done" : "pending") as ShredStep["status"], detail: skipKeys && s.id !== "arkiv" ? "already done" : undefined }));
  if (!skipKeys) { steps[0].status = "running"; steps[1].status = "running"; }
  onStep(steps.map((s) => ({ ...s })));
  return (id: string, status: "running" | "done" | "error", detail?: string) => {
    const s = steps.find((x) => x.id === id);
    if (s) { s.status = status; s.detail = detail; }
    onStep(steps.map((x) => ({ ...x })));
  };
}

async function finishReceipt(zk: ArkivZKType, res: { txHashes: Hex[]; receipts: Hex[]; deleted: Hex[] }) {
  if (res.receipts.length === 0) throw new Error("Keys destroyed; no live Arkiv entities needed cleanup, so no receipt was published");
  const s = await sdk();
  const r = await s.getReceipt(zk.publicClient, res.receipts[0]);
  return receiptView(r, res.txHashes[0], res.deleted);
}

export async function shredRecords(entityKeys: string[], onStep: (steps: ShredStep[]) => void): Promise<ShredReceiptView> {
  const { zk } = await requireSession();
  const update = stepTracker(onStep);
  try {
    const res = await zk.shred(entityKeys, update);
    return await finishReceipt(zk, res);
  } catch (e) {
    update("arkiv", "error", msg(e));
    throw e;
  }
}

export async function retryShredPublish(entityKeys: string[], onStep: (steps: ShredStep[]) => void): Promise<ShredReceiptView> {
  const { zk } = await requireSession();
  const update = stepTracker(onStep, true);
  const res = await zk.publishShredReceipts(entityKeys, update);
  return finishReceipt(zk, res);
}

/** Shred a whole month: destroys the collection key(s), so every record of that epoch dies at once. */
export async function shredEpoch(epoch: string, onStep: (steps: ShredStep[]) => void): Promise<ShredReceiptView | null> {
  const { zk } = await requireSession();
  const update = stepTracker(onStep);
  const res = await zk.shredEpoch(epoch, update);
  return res.receipts.length ? finishReceipt(zk, res) : null;
}

/** Shred everything: all collection + record keys, then this vault's identity. */
export async function shredAccount(onStep: (steps: ShredStep[]) => void): Promise<ShredReceiptView | null> {
  const { zk } = await requireSession();
  const update = stepTracker(onStep);
  const res = await zk.shredAccount(update);
  session = null;
  return res.receipts.length ? finishReceipt(zk, res) : null;
}

export async function listCollections(): Promise<CollectionView[]> {
  const { zk } = await requireSession();
  const recs = await zk.vault.listRecords();
  return (await zk.vault.listCollections()).map((c) => ({
    collectionId: c.collectionId, schemaId: c.schemaId, epoch: c.epoch, status: c.status,
    records: recs.filter((r) => r.collectionId === c.collectionId).length,
  }));
}

/** Blind-index search over encrypted fields (only fields marked searchable at creation). */
export async function searchRecords(schemaId: string, field: string, value: FieldValue): Promise<{ keys: string[]; queries: number; tagsTried: number }> {
  const { zk } = await requireSession();
  return zk.search(schemaId, field, value);
}

/* ================================================================ public: verify / receipts */

export async function verifyProof(proofEntityKey: string): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(proofEntityKey)) throw new Error("Not a valid entity key");
  const s = await sdk();
  const r = await s.verifyProofEntity(await publicClient(), proofEntityKey);
  return { ...r, recordStatus: r.recordStatus };
}

export async function getReceipt(receiptKey: string): Promise<ShredReceiptView> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(receiptKey)) throw new Error("Not a valid entity key");
  const s = await sdk();
  return receiptView(await s.getReceipt(await publicClient(), receiptKey));
}

export async function erasureCertificate(receiptKey: string): Promise<object> {
  const s = await sdk();
  return s.erasureCertificate(await s.getReceipt(await publicClient(), receiptKey));
}

/* ================================================================ archive ("old node runner") */

type Capture = {
  txHash: string; blockNumber: string; capturedAt: number; bytes: number; from: string;
  ops: { op: string; entityKey?: string; attributes?: { name: string; type: string; value: string }[] }[];
};
const isOurs = (c: Capture) => c.ops.some((o) => o.op === "create" && o.attributes?.some((a) => a.name === "app" && a.value === "arkivzk"));

export async function listArchive(): Promise<ArchiveItem[]> {
  const r = await fetch("/api/archive");
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "archive unavailable");
  const ours = (j.items as Capture[]).filter(isOurs);
  const recordKeys = ours.flatMap((c) => c.ops.filter((o) => o.op === "create" && o.attributes?.some((a) => a.name === "ct")).map((o) => o.entityKey!.toLowerCase()));
  const s = await sdk();
  const shredded = new Set<string>();
  if (recordKeys.length) {
    const q = new s.QueryPlanner(await publicClient());
    const { rows } = await q.run({ from: s.ShredReceipt, where: { app: "arkivzk", recordKey: { in: recordKeys } }, select: ["recordKey"] });
    rows.forEach((row: { recordKey: { value: string } }) => shredded.add(row.recordKey.value.toLowerCase()));
  }
  return ours.map((c) => {
    const keys = c.ops.map((o) => o.entityKey).filter(Boolean) as string[];
    return {
      txHash: c.txHash, blockNumber: c.blockNumber, capturedAt: c.capturedAt, bytes: c.bytes, entityKeys: keys,
      recordShredded: keys.some((k) => shredded.has(k.toLowerCase())),
    };
  });
}

export async function tryDecryptArchived(txHash: string): Promise<DecryptAttempt> {
  const r = await fetch(`/api/archive/${txHash}`);
  const c = await r.json();
  if (!r.ok) throw new Error(c.error ?? "capture not found");
  const create = (c as Capture).ops.find((o) => o.op === "create" && o.attributes?.some((a) => a.name === "ct"));
  if (!create) return { success: false, log: ["This capture has no arkivzk record ciphertext (it is a proof, VK or receipt: public by design)."] };
  const attr = (n: string) => create.attributes!.find((a) => a.name === n)?.value ?? "";
  const ct = attr("ct"), envId = attr("envId"), schemaId = attr("schemaId"), epoch = attr("epoch");
  const log = [
    `Captured tx ${txHash.slice(0, 12)}… in block ${c.blockNumber}: ${c.bytes} bytes of raw calldata`,
    `Decoded create op: ciphertext ${(ct.length - 2) / 2} B, commitment ${attr("commitment").slice(0, 14)}…`,
    "An archive node has exactly this. No key material was ever written on-chain.",
  ];
  const { fromHex } = await import("@arkivzk/crypto");
  let acct: Hex | null = null;
  try { acct = await currentAccount(); } catch { /* no wallet */ }
  if (!acct) {
    log.push("No wallet/vault in this browser: no key shares available, guardians release shares only to the controller's signature.");
    log.push("RESULT: undecryptable");
    return { success: false, log };
  }
  log.push("Trying with the strongest attacker possible: the owner's own vault + both guardians…");
  const { zk } = await requireSession();
  const res = await zk.tryDecryptCaptured(fromHex(ct), fromHex(envId), schemaId, epoch);
  return { success: res.success, log: [...log, ...res.log] };
}

/* ================================================================ lease / renew */

export async function renewRecords(entityKeys: string[], seconds: number, onStep?: (s: string) => void): Promise<{ txHash: string; extended: number }> {
  const { zk } = await requireSession();
  const s = await sdk();
  return new s.LeaseManager(zk).renew(entityKeys, seconds, onStep);
}

export async function expiringSoon(withinDays: number): Promise<LocalRecord[]> {
  const { zk } = await requireSession();
  const s = await sdk();
  return (await new s.LeaseManager(zk).expiringSoon(withinDays * 86400_000)).map(toLocal);
}

export async function reminderIcsUrl(entityKey: string, daysBefore: number): Promise<string> {
  const { zk } = await requireSession();
  const s = await sdk();
  const r = await zk.vault.getRecord(entityKey);
  if (!r) throw new Error("record not found in this vault");
  const ics = s.reminderIcs(r, daysBefore, `${location.origin}/app`);
  return URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
}

/* ================================================================ recovery */

export async function exportRecoveryKit(passphrase: string): Promise<string> {
  const { zk } = await requireSession();
  return zk.vault.exportRecoveryKit(passphrase);
}

export async function restoreFromKit(kitJson: string, passphrase: string, onStep?: (s: string) => void): Promise<string[]> {
  const acct = await currentAccount();
  if (!acct) throw new Error("Connect your wallet first.");
  const s = await sdk();
  onStep?.("Decrypting recovery kit (scrypt, ~1-2 s)…");
  const vault = await s.Vault.importRecoveryKit(
    new s.IndexedDBKV("arkivzk-vault-" + acct.toLowerCase()), s.webCryptoSealer(await deviceKey(acct)), kitJson, passphrase,
  );
  const zk = await buildZk(acct, vault);
  session = { address: acct, zk };
  onStep?.("Searching Arkiv for records owned by this wallet…");
  return zk.recover(acct, onStep);
}

/* ================================================================ query explorer */

async function presetSpec(p: QueryPreset): Promise<QuerySpec> {
  const s = await sdk();
  if (p.kind === "addressedTo") {
    if (!p.nonce) throw new Error("Enter the verifier nonce");
    return { from: s.ZkProof, where: { app: "arkivzk", audience: s.audienceFor(p.nonce), ...(p.claim ? { claim: p.claim } : {}) }, select: ["recordKey", "claim", "$owner", "$expiresAt"] };
  }
  const { address, zk } = await requireSession();
  if (p.kind === "myRecords")
    return { from: s.ZkRecord, where: { app: "arkivzk" }, ownedBy: address, select: ["schemaId", "epoch", "commitment", "$expiresAt"] };
  const keys = (await zk.vault.listRecords()).filter((r) => r.status === "live").map((r) => r.entityKey.toLowerCase());
  if (keys.length === 0) throw new Error("No live records in this vault yet");
  return { from: s.ZkProof, where: { app: "arkivzk", recordKey: { in: keys } }, select: ["recordKey", "claim", "circuitId", "$expiresAt"] };
}

export async function explainQuery(p: QueryPreset): Promise<string> {
  const s = await sdk();
  return new s.QueryPlanner(await publicClient()).explain(await presetSpec(p));
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "value" in (v as object)) return cell((v as { value: unknown }).value);
  return typeof v === "bigint" ? v.toString() : String(v);
};

export async function runQuery(p: QueryPreset): Promise<{ rows: Record<string, string>[]; queries: number; plan: string }> {
  const s = await sdk();
  const q = new s.QueryPlanner(await publicClient());
  const spec = await presetSpec(p);
  const { rows, queries } = await q.run(spec);
  return {
    rows: rows.map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]))),
    queries,
    plan: q.explain(spec),
  };
}
