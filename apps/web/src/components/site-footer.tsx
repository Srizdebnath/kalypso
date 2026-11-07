import Link from "next/link";
import { LogoMark, Wordmark } from "./site-header";
import { BackToTop } from "./back-to-top";
import { CHAIN_ID, LIVE_LINKS } from "@/lib/live";

const COLS: { t: string; l: [string, string][] }[] = [
  { t: "Product", l: [["Vault", "/app"], ["Prove", "/app/prove"], ["Shred", "/app/shred"], ["Query explorer", "/app/query"], ["Archive node", "/archive"]] },
  { t: "Docs", l: [["Getting started", "/docs/00-getting-started"], ["SDK reference", "/docs/06-sdk-reference"], ["Crypto-shredding", "/docs/04-crypto-shredding"], ["Performance", "/docs/07-performance"], ["Design FAQ", "/docs/08-design-faq"], ["Limits & threat model", "/docs/01-idea"]] },
  { t: "Arkiv", l: [["Arkiv docs", "https://docs.arkiv.network"], ["Rabdi explorer", "https://rabdi.explorer.arkiv.network"], ["Arkiv Hub", "https://hub.arkiv.network"]] },
];

const ext = (h: string) => h.startsWith("http");

function FLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return ext(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>{children}</a>
  ) : (
    <Link href={href} className={className}>{children}</Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative mt-28 overflow-hidden border-t border-white/10 bg-black">
      {/* CTA */}
      <div className="relative mx-auto max-w-6xl px-5 pt-20">
        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(80%_120%_at_50%_0%,#1c1c1c,#050505_70%)] px-6 py-14 text-center md:px-12">
          <div className="stars" />
          <div aria-hidden className="absolute top-[-60%] left-1/2 aspect-square w-[70%] -translate-x-1/2 rounded-full border border-white/30 shadow-[0_0_80px_10px_rgb(255_255_255/0.08),inset_0_0_60px_rgb(255_255_255/0.06)]" style={{ animation: "pulse-glow 7s ease-in-out infinite" }} />
          <p className="relative font-mono text-xs tracking-[0.25em] text-white/50 uppercase">Your data · your keys · your delete button</p>
          <h2 className="text-gradient relative mx-auto mt-4 max-w-2xl text-4xl font-bold tracking-tight md:text-5xl">Ship private data on a public chain.</h2>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/app" className="nb-btn bg-ink px-7 py-3">Open the app →</Link>
            <Link href="/docs/00-getting-started" className="nb-btn glass px-7 py-3 text-white">Read the guide</Link>
          </div>
        </div>
      </div>

      {/* links */}
      <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-12 px-5 pt-20 pb-12 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div className="col-span-2 md:col-span-1">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <LogoMark />
            <Wordmark />
          </Link>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/55">
            Client-side encryption, zero-knowledge proofs and crypto-shredding for the Arkiv DB-chain.
          </p>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <p className="flex items-center gap-2 font-mono text-[0.68rem] tracking-wider text-white/60 uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#fff] opacity-60" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-[#fff]" />
              </span>
              Live on Rabdi · chain {CHAIN_ID}
            </p>
            <ul className="mt-3 space-y-1.5">
              {LIVE_LINKS.map((l) => (
                <li key={l.href}>
                  <FLink href={l.href} className="group flex items-center justify-between text-sm text-white/70 transition-colors hover:text-white">
                    {l.label}
                    <span className="text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-white">{ext(l.href) ? "↗" : "→"}</span>
                  </FLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {COLS.map((c) => (
          <div key={c.t}>
            <p className="mb-4 text-[0.68rem] font-semibold tracking-[0.2em] text-white/40 uppercase">{c.t}</p>
            <ul className="space-y-2.5 text-sm">
              {c.l.map(([label, href]) => (
                <li key={href}>
                  <FLink href={href} className="text-white/70 transition-colors hover:text-white">
                    {label}
                    {ext(href) && <span className="ml-1 text-white/30">↗</span>}
                  </FLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* giant wordmark */}
      <div aria-hidden className="relative mx-auto max-w-[100rem] overflow-hidden px-2">
        <p
          className="font-display translate-y-[18%] text-center text-[14.5vw] leading-none font-bold tracking-[0.02em] text-transparent select-none"
          style={{ WebkitTextStroke: "1px rgb(255 255 255 / 0.18)", backgroundImage: "linear-gradient(180deg, rgb(255 255 255 / 0.10), transparent 80%)", WebkitBackgroundClip: "text", backgroundClip: "text" }}
        >
          KALYPSO
        </p>
      </div>

      {/* bottom bar */}
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Kalypso · MIT · Built for ETHGlobal Mumbai, Arkiv track</p>
          <div className="flex items-center gap-4">
            <span>Research-grade, not audited</span>
            <BackToTop />
          </div>
        </div>
      </div>
    </footer>
  );
}
