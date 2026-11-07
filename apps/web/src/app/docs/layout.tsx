import { Suspense } from "react";
import { listDocs } from "@/lib/docs";
import { groupDocs } from "@/lib/docs-groups";
import { DocsNav } from "./docs-nav";

export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const docs = await listDocs();
  const groups = groupDocs([
    ...docs.map((d) => ({ href: `/docs/${d.slug}`, label: d.title, file: d.file })),
    { href: "/docs/api", label: "API · arkivzk-client" },
  ]);
  return (
    <div className="docs-light">
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="min-w-0 border-[#ececec] px-4 pt-6 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:border-r lg:pt-10 lg:pb-10">
          <Suspense fallback={<DocsNav groups={groups} />}>
            <DocsNav groups={groups} />
          </Suspense>
        </aside>
        <div className="min-w-0 px-5 pt-8 pb-24 lg:px-14 lg:pt-12">{children}</div>
      </div>
    </div>
  );
}
