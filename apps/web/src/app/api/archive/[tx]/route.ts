export async function GET(_request: Request, { params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return Response.json({ error: "bad tx hash" }, { status: 400 });
  const base = process.env.ARCHIVE_URL ?? "http://127.0.0.1:7301";
  try {
    const r = await fetch(`${base}/captures/${tx}`, { cache: "no-store" });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "archive indexer not running" }, { status: 503 });
  }
}
