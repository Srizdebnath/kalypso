import { Suspense } from "react";
import { listDocs } from "@/lib/docs";
import { DocsNav } from "./docs-nav";

export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const docs = await listDocs();
  const items = [
    ...docs.map((d) => ({ href: `/docs/${d.slug}`, label: d.title })),
    { href: "/docs/api", label: "API · arkivzk-client" },
  ];
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[17rem_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Suspense fallback={<DocsNav items={items} />}>
          <DocsNav items={items} />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
