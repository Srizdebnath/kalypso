import Link from "next/link";
import type { Metadata } from "next";
import { listDocs } from "@/lib/docs";
import { describe, groupDocs, splitTitle } from "@/lib/docs-groups";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = { title: "Docs" };

const QUICK = `pnpm install && pnpm build
# apps/web/.env.local -> ARKIV_ACCESS_KEY=<your Hub key>
(cd guardian && pnpm build && pnpm start:g1) & (cd guardian && pnpm start:g2) &
cd apps/web && pnpm build && pnpm start      # http://localhost:3000`;

const TASKS = [
  ["Store and read an encrypted record", "/docs/06-sdk-reference#2-zkput-encrypt-commit-split-the-key-write-once"],
  ["Publish and verify a ZK proof", "/docs/03-zk"],
  ["Search, range-filter and count ciphertext", "/docs/06-sdk-reference#8e-range-count-join-and-cascade-on-encrypted-data"],
  ["Link records and cascade a delete", "/docs/06-sdk-reference#8f-relational-layer-atomic-inserts-1n-mn-cascade"],
  ["Shred data and get a receipt", "/docs/04-crypto-shredding"],
  ["Recover a vault on a new device", "/docs/06-sdk-reference#9-recovery-lost-device"],
];

export default async function DocsIndex() {
  const docs = await listDocs();
  const groups = groupDocs([
    ...docs.map((d) => ({ href: `/docs/${d.slug}`, label: d.title, file: d.file })),
    { href: "/docs/api", label: "API · arkivzk-client", file: "src/lib/arkivzk-client.ts" },
  ]);

  return (
    <div>
      <header className="relative mb-12 overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(120%_140%_at_80%_0%,#1c1c1c_0%,#0a0a0a_45%,#000000_80%)] p-8 md:p-12">
        <div className="stars" />
        <div aria-hidden className="absolute -top-40 -right-40 h-96 w-96 rounded-full border border-white/40 shadow-[0_0_50px_8px_rgb(164_164_164/0.5),inset_0_0_40px_rgb(147_147_147/0.5)]" style={{ animation: "pulse-glow 6s ease-in-out infinite" }} />
        <div className="relative max-w-2xl">
          <p className="font-mono text-xs tracking-[0.2em] text-[#b9b9b9] uppercase">Documentation</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white md:text-5xl">Build private apps on Arkiv</h1>
          <p className="mt-4 text-lg text-[#cbcbcb]">
            Guides, design notes and the SDK reference for arkivzk, rendered from the repository&apos;s <code className="font-mono text-white">docs/</code> folder.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/docs/00-getting-started" className="nb-btn bg-ink">Getting started →</Link>
            <Link href="/docs/06-sdk-reference" className="nb-btn glass text-white">SDK reference</Link>
          </div>
        </div>
      </header>

      <div className="mb-14 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Reveal className="min-w-0">
          <div className="nb-card h-full p-0">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3 text-xs text-[#7a7a7a]">
              <span className="font-mono">quick start</span>
              <Link href="/docs/00-getting-started" className="hover:text-white">full guide →</Link>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[0.8rem] leading-relaxed text-[#dcdcdc]">{QUICK}</pre>
          </div>
        </Reveal>
        <Reveal delay={100} className="min-w-0">
          <div className="nb-card h-full p-6">
            <p className="mb-4 text-[0.68rem] font-semibold tracking-[0.18em] text-[#7a7a7a] uppercase">I want to…</p>
            <ul className="space-y-1">
              {TASKS.map(([t, href]) => (
                <li key={t}>
                  <Link href={href} className="group flex items-center justify-between rounded-xl px-3 py-2 text-sm text-[#cbcbcb] transition-colors hover:bg-white/5 hover:text-white">
                    {t}
                    <span className="text-[#7a7a7a] transition-transform group-hover:translate-x-1">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      {groups.map((g) => (
        <section key={g.title} className="mb-12">
          <h2 className="mb-5 text-[0.7rem] font-semibold tracking-[0.2em] text-[#999999] uppercase">{g.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((d, i) => {
              const { num, name } = splitTitle(d.label);
              return (
                <Reveal key={d.href} delay={i * 70} className="h-full">
                  <Link href={d.href} className="nb-card lift group block h-full p-6">
                    <div className="flex items-center justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 font-mono text-xs text-[#b9b9b9]">{num || "{}"}</span>
                      <span className="text-[#7a7a7a] transition-transform group-hover:translate-x-1">→</span>
                    </div>
                    <p className="mt-4 font-semibold text-white">{name}</p>
                    <p className="mt-2 text-sm text-[#a3a3a3]">{describe(d.href)}</p>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
