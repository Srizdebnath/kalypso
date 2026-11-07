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
  const { name } = splitTitle(doc.title);

  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_12rem]">
      <div className="min-w-0 max-w-3xl">
        <div className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-[#8a8a8a]">
          <Link href="/docs" className="hover:text-[#0a0a0a]">Docs</Link>
          <span>/</span>
          <span className="text-[#404040]">{name.split(":")[0]}</span>
          <span className="ml-auto">{minutes} min read</span>
        </div>
        {doc.headings.length > 3 && (
          <details className="mb-8 rounded-lg border border-[#e5e5e5] p-3 xl:hidden">
            <summary className="cursor-pointer text-sm text-[#171717]">On this page</summary>
            <div className="mt-3">
              <Toc headings={doc.headings} />
            </div>
          </details>
        )}
        <article>
          <Markdown source={doc.content} />
        </article>
        <nav className="mt-14 grid gap-3 border-t border-[#ededed] pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="rounded-lg border border-[#e5e5e5] p-4 transition-colors hover:border-[#0a0a0a]">
              <span className="text-xs text-[#8a8a8a]">Previous</span>
              <span className="mt-1 block text-sm font-medium text-[#0a0a0a]">← {prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          <Link href={next ? `/docs/${next.slug}` : "/docs/api"} className="rounded-lg border border-[#e5e5e5] p-4 text-right transition-colors hover:border-[#0a0a0a]">
            <span className="text-xs text-[#8a8a8a]">Next</span>
            <span className="mt-1 block text-sm font-medium text-[#0a0a0a]">{next ? next.title : "Client API"} →</span>
          </Link>
        </nav>
      </div>
      {doc.headings.length > 0 && (
        <aside className="hidden xl:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <p className="mb-3 text-[0.8rem] font-medium text-[#8a8a8a]">On this page</p>
            <Toc headings={doc.headings} />
          </div>
        </aside>
      )}
    </div>
  );
}
