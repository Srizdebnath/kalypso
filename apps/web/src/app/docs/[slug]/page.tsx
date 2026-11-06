import Link from "next/link";
import { notFound } from "next/navigation";
import { getDoc, listDocs } from "@/lib/docs";
import { Markdown } from "@/components/markdown";

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

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_14rem]">
      <article className="nb-card min-w-0 p-6 md:p-10">
        <p className="mb-4 font-mono text-xs font-bold opacity-60">docs/{doc.file}</p>
        {doc.headings.length > 3 && (
          <details className="nb-border mb-6 bg-paper p-3 xl:hidden">
            <summary className="cursor-pointer font-mono text-xs font-bold uppercase">
              On this page ({doc.headings.length})
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {doc.headings.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "pl-3" : ""}>
                  <a href={`#${h.id}`} className="hover:bg-yellow">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
        <Markdown source={doc.content} />
        <nav className="mt-10 flex flex-wrap justify-between gap-3 border-t-[3px] border-ink pt-6">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="nb-btn bg-white">
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/docs/${next.slug}`} className="nb-btn bg-yellow">
              {next.title} →
            </Link>
          ) : (
            <Link href="/docs/api" className="nb-btn bg-yellow">
              API reference →
            </Link>
          )}
        </nav>
      </article>
      {doc.headings.length > 0 && (
        <aside className="hidden xl:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto nb-border bg-white p-4">
            <p className="mb-2 font-mono text-xs font-bold uppercase">On this page</p>
            <ul className="space-y-1.5 text-sm">
              {doc.headings.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "pl-3" : ""}>
                  <a href={`#${h.id}`} className="hover:bg-yellow">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
