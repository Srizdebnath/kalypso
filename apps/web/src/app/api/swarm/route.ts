// Encrypted attachments <-> Swarm. Only ciphertext ever passes through here.
import { beeBlobStore } from "@arkivzk/swarm";

const MAX = 10 * 1024 * 1024;

function store() {
  const url = process.env.BEE_URL, batch = process.env.SWARM_POSTAGE_BATCH_ID;
  if (!url || !batch) return null;
  return beeBlobStore(url, batch);
}

export async function POST(request: Request) {
  const s = store();
  if (!s) return Response.json({ error: "Swarm not configured on this server (BEE_URL, SWARM_POSTAGE_BATCH_ID)" }, { status: 503 });
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX) return Response.json({ error: "attachment must be 1 byte .. 10 MiB" }, { status: 413 });
  try {
    return Response.json({ reference: await s.upload(buf) });
  } catch (e) {
    return Response.json({ error: `Bee upload failed: ${(e as Error).message}` }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const s = store();
  if (!s) return Response.json({ error: "Swarm not configured" }, { status: 503 });
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  try {
    const data = await s.download(ref);
    return new Response(data as BodyInit, { headers: { "content-type": "application/octet-stream" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
