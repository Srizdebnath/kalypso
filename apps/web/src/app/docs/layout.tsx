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
    <div className="mx-auto grid max-w-7xl gap-8 px-4 pt-10 pb-10 lg:grid-cols-[16rem_1fr]">
      <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        <Suspense fallback={<DocsNav groups={groups} />}>
          <DocsNav groups={groups} />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
