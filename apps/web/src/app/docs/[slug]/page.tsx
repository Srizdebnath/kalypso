import Link from "next/link";
import { notFound } from "next/navigation";
import { getDoc, listDocs } from "@/lib/docs";
import { Markdown } from "@/components/markdown";
import { splitTitle } from "@/lib/docs-groups";
import { Toc } from "../toc";

export async function generateStaticParams() {
  const docs = await listDocs();
  return docs.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const doc = await getDoc(slug);
  return { title: doc?.title ?? "Docs" };
}

// Every doc is prerendered via generateStaticParams; awaiting params at the top
// keeps a real 404 status for unknown slugs.
export const instant = false;

export default async function DocPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const [doc, all] = await Promise.all([getDoc(slug), listDocs()]);
  if (!doc) notFound();

  const idx = all.findIndex((d) => d.slug === slug);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

  const words = doc.content.split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 220));
  const { num, name } = splitTitle(doc.title);

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#999999]">
          <Link href="/docs" className="hover:text-white">Docs</Link>
          <span className="text-[#5b5b5b]">/</span>
          <span className="text-white">{num ? `${num} · ` : ""}{name.split(":")[0]}</span>
          <span className="ml-auto font-mono text-xs">{minutes} min read · {doc.file}</span>
        </div>
        {doc.headings.length > 3 && (
          <details className="glass mb-6 rounded-2xl p-4 xl:hidden">
            <summary className="cursor-pointer text-sm font-medium text-white">On this page</summary>
            <div className="mt-3">
              <Toc headings={doc.headings} />
            </div>
          </details>
        )}
        <article className="nb-card min-w-0 p-6 md:p-12">
          <Markdown source={doc.content} />
        </article>
        <nav className="mt-6 grid gap-4 sm:grid-cols-2">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="nb-card lift block p-5">
              <span className="text-xs text-[#7a7a7a]">← Previous</span>
              <span className="mt-1 block font-medium text-white">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          <Link href={next ? `/docs/${next.slug}` : "/docs/api"} className="nb-card lift block p-5 text-right">
            <span className="text-xs text-[#7a7a7a]">Next →</span>
            <span className="mt-1 block font-medium text-white">{next ? next.title : "API · arkivzk-client"}</span>
          </Link>
        </nav>
      </div>
      {doc.headings.length > 0 && (
        <aside className="hidden xl:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <p className="mb-3 text-[0.68rem] font-semibold tracking-[0.18em] text-[#7a7a7a] uppercase">On this page</p>
            <Toc headings={doc.headings} />
          </div>
        </aside>
      )}
    </div>
  );
}
