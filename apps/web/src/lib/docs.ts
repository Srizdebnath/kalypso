import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./slug";

/** Repo-level docs folder (apps/web -> ../../docs). */
const DOCS_DIR = path.join(process.cwd(), "..", "..", "docs");

export type DocMeta = { slug: string; title: string; file: string };
export type Doc = DocMeta & { content: string; headings: { id: string; text: string; depth: number }[] };

function titleOf(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function headingsOf(content: string) {
  const out: Doc["headings"] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+)$/);
    if (m) out.push({ depth: m[1].length, text: m[2].replace(/[`*]/g, "").trim(), id: slugify(m[2]) });
  }
  return out;
}

export async function listDocs(): Promise<DocMeta[]> {
  "use cache";
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(path.join(DOCS_DIR, file), "utf8");
      const slug = file.replace(/\.md$/, "");
      return { slug, file, title: titleOf(content, slug) };
    }),
  );
}

export async function getDoc(slug: string): Promise<Doc | null> {
  "use cache";
  if (!/^[\w-]+$/.test(slug)) return null;
  const file = `${slug}.md`;
  let content: string;
  try {
    content = await readFile(path.join(DOCS_DIR, file), "utf8");
  } catch {
    return null;
  }
  return { slug, file, title: titleOf(content, slug), content, headings: headingsOf(content) };
}
