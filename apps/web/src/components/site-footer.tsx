import Link from "next/link";
import { Wordmark } from "./site-header";

const COLS = [
  { t: "Product", l: [["Open the app", "/app"], ["Archive node", "/archive"], ["How it works", "/#how"]] },
  { t: "Docs", l: [["Getting started", "/docs/00-getting-started"], ["SDK reference", "/docs/06-sdk-reference"], ["Performance", "/docs/07-performance"], ["Design FAQ", "/docs/08-design-faq"]] },
  { t: "Network", l: [["Arkiv docs", "https://docs.arkiv.network"], ["Rabdi explorer", "https://rabdi.explorer.arkiv.network"], ["Arkiv Hub", "https://hub.arkiv.network"]] },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-white/10">
      <div aria-hidden className="pointer-events-none absolute -bottom-[60%] left-1/2 h-[120%] w-[140%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(93_93_93/0.25),transparent)]" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Wordmark className="text-lg" />
          <p className="mt-4 max-w-xs text-sm text-[#a3a3a3]">
            Private data on a public database. Encrypt, prove and shred on Arkiv.
          </p>
          <p className="mt-4 text-xs text-[#7a7a7a]">Hackathon project · ETHGlobal Mumbai · Arkiv track. Research-grade, not audited.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.t}>
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[#7a7a7a] uppercase">{c.t}</p>
            <ul className="space-y-2 text-sm">
              {c.l.map(([label, href]) => (
                <li key={href}>
                  {href.startsWith("http") ? (
                    <a href={href} target="_blank" rel="noreferrer" className="text-[#cbcbcb] transition-colors hover:text-white">{label} ↗</a>
                  ) : (
                    <Link href={href} className="text-[#cbcbcb] transition-colors hover:text-white">{label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
