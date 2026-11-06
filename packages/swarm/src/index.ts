import { Bee } from "@ethersphere/bee-js";

/**
 * Encrypted attachments on Swarm. arkivzk only ever uploads AES-256-GCM ciphertext; the key is
 * derived from the record DEK, so shredding the record also makes the Swarm copy undecryptable
 * (Swarm, like Arkiv history, can't be relied on to forget: postage expiry is not erasure).
 */
export interface BlobStore {
  readonly name: string;
  upload(data: Uint8Array): Promise<string>;
  download(ref: string): Promise<Uint8Array>;
}

const hexOf = (r: any): string => (typeof r?.toHex === "function" ? r.toHex() : String(r));
const bytesOf = (b: any): Uint8Array =>
  typeof b?.toUint8Array === "function" ? b.toUint8Array() : b instanceof Uint8Array ? b : new Uint8Array(b?.bytes ?? b);

/** Server-side: talks to a Bee node with a postage batch. */
export function beeBlobStore(beeUrl: string, postageBatchId: string): BlobStore {
  const bee = new Bee(beeUrl);
  return {
    name: "Swarm",
    async upload(data) {
      const res = await bee.data.upload(postageBatchId, data);
      return hexOf(res.reference);
    },
    async download(ref) {
      if (!/^[0-9a-fA-F]{64}$|^[0-9a-fA-F]{128}$/.test(ref.replace(/^0x/, ""))) throw new Error("invalid swarm reference");
      return bytesOf(await bee.data.download(ref.replace(/^0x/, "")));
    },
  };
}

/** Browser-side: goes through the app's /api/swarm route (Bee URL + batch id stay on the server). */
export function httpBlobStore(apiBase = "/api/swarm"): BlobStore {
  return {
    name: "Swarm",
    async upload(data) {
      const r = await fetch(apiBase, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: data as BodyInit });
      const j = await r.json();
      if (!r.ok) throw new Error(`swarm upload failed: ${j.error ?? r.status}`);
      return j.reference as string;
    },
    async download(ref) {
      const r = await fetch(`${apiBase}?ref=${encodeURIComponent(ref)}`);
      if (!r.ok) throw new Error(`swarm download failed: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}
