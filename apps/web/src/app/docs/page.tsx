import Link from "next/link";
import type { Metadata } from "next";
import { listDocs } from "@/lib/docs";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Docs" };

const TONES = ["bg-cyan", "bg-pink", "bg-lime", "bg-yellow", "bg-violet"];

export default async function DocsIndex() {
  const docs = await listDocs();
  return (
    <div>
      <PageHeader kicker="documentation" title="Docs">
        The design notes behind arkivzk, rendered straight from the repository&apos;s{" "}
        <code className="font-mono">docs/</code> folder. Read them in order.
      </PageHeader>
      <ol className="grid gap-5 sm:grid-cols-2">
        {docs.map((d, i) => (
          <li key={d.slug}>
            <Link
              href={`/docs/${d.slug}`}
              className={`nb-card block h-full p-5 transition-transform hover:-translate-y-1 ${TONES[i % TONES.length]}`}
            >
              <span className="font-mono text-xs font-bold">{d.file}</span>
              <p className="mt-1 text-xl font-bold">{d.title}</p>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/docs/api"
            className="nb-card block h-full bg-white p-5 transition-transform hover:-translate-y-1"
          >
            <span className="font-mono text-xs font-bold">src/lib/arkivzk-client.ts</span>
            <p className="mt-1 text-xl font-bold">API · arkivzk-client</p>
          </Link>
        </li>
      </ol>
    </div>
  );
}
