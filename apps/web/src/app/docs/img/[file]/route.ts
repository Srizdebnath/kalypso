import { readFile } from "node:fs/promises";
import path from "node:path";

/** Serves images that live next to the markdown docs (repo docs/img/*). */
const IMG_DIR = path.join(process.cwd(), "..", "..", "docs", "img");

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(_req: Request, ctx: RouteContext<"/docs/img/[file]">) {
  const { file } = await ctx.params;
  const ext = path.extname(file).toLowerCase();
  if (!/^[\w.-]+$/.test(file) || file.includes("..") || !TYPES[ext]) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(IMG_DIR, file));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": TYPES[ext],
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
