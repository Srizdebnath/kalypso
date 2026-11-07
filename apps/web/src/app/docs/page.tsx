import Link from "next/link";
import type { Metadata } from "next";
import { listDocs } from "@/lib/docs";
import { describe, groupDocs, splitTitle } from "@/lib/docs-groups";

export const metadata: Metadata = { title: "Docs" };

const QUICK = `pnpm install && pnpm build
# apps/web/.env.local -> ARKIV_ACCESS_KEY=<your Hub key>
cd guardian && pnpm build && pnpm start:g1   # and start:g2 in another terminal
cd apps/web && pnpm build && pnpm start      # http://localhost:3000`;

export default async function DocsIndex() {
  const docs = await listDocs();
  const groups = groupDocs([
    ...docs.map((d) => ({ href: `/docs/${d.slug}`, label: d.title, file: d.file })),
    { href: "/docs/api", label: "Client API" },
  ]);

  return (
    <div className="max-w-3xl">
      <p className="mb-8 text-[0.8rem] text-[#8a8a8a]">Docs / Introduction</p>
      <h1 className="text-[2rem] font-semibold tracking-tight text-[#0a0a0a]">Introduction</h1>
      <p className="mt-4 leading-relaxed text-[#404040]">
        Kalypso is a TypeScript library for Arkiv. It encrypts records on your device, keeps only ciphertext and commitments on-chain,
        lets anyone verify zero-knowledge claims about the data, and erases it for good by destroying the keys. It also lets you search,
        count and join encrypted records using Arkiv&apos;s own index.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/docs/00-getting-started" className="rounded-full bg-[#0a0a0a] px-4 py-2 text-sm font-medium text-[#fff] hover:opacity-85">
          Get started →
        </Link>
        <Link href="/docs/06-sdk-reference" className="rounded-full border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:border-[#0a0a0a]">
          SDK reference
        </Link>
      </div>

      <h2 className="mt-14 border-t border-[#ededed] pt-10 text-[1.35rem] font-semibold text-[#0a0a0a]">Quick start</h2>
      <pre className="mt-4 overflow-x-auto rounded-xl bg-[#0a0a0a] p-5 font-mono text-[0.8rem] leading-relaxed text-[#e5e5e5]">{QUICK}</pre>
      <p className="mt-3 text-sm text-[#737373]">
        Full setup, a tour of the app and troubleshooting are in{" "}
        <Link href="/docs/00-getting-started" className="text-[#0a0a0a] underline decoration-[#c4c4c4] underline-offset-4">Getting started</Link>.
      </p>

      {groups.map((g) => (
        <section key={g.title} className="mt-12">
          <h2 className="text-[1.35rem] font-semibold text-[#0a0a0a]">{g.title}</h2>
          <ul className="mt-4 divide-y divide-[#f0f0f0] rounded-xl border border-[#ebebeb]">
            {g.items.map((d) => {
              const { num, name } = splitTitle(d.label);
              return (
                <li key={d.href}>
                  <Link href={d.href} className="group flex items-start gap-4 p-4 transition-colors hover:bg-[#fafafa]">
                    <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-[#a3a3a3]">{num || "—"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[#0a0a0a]">{name}</span>
                      <span className="mt-0.5 block text-sm text-[#737373]">{describe(d.href)}</span>
                    </span>
                    <span className="text-[#c4c4c4] transition-transform group-hover:translate-x-0.5 group-hover:text-[#0a0a0a]">→</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
