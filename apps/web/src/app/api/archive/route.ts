// Proxy to the archive indexer ("old node runner"), so the browser needs no extra CORS setup.
export async function GET() {
  const base = process.env.ARCHIVE_URL ?? "http://127.0.0.1:7301";
  try {
    const r = await fetch(`${base}/captures`, { cache: "no-store" });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "archive indexer not running (start archive/: node dist/indexer.js)" }, { status: 503 });
  }
}
