import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "./nav-links";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[0.95rem] font-bold tracking-[0.28em] text-white ${className}`}>
      ARKIV<span className="text-white/45">ZK</span>
    </span>
  );
}

export function LogoMark() {
  return (
    <span className="relative grid h-8 w-8 place-items-center">
      <span className="absolute inset-0 rounded-full border border-white/70 shadow-[0_0_14px_rgb(255_255_255/0.45)]" />
      <span className="absolute inset-0 rounded-full border-t border-white" style={{ animation: "spin-slow 4s linear infinite" }} />
      <span className="h-2 w-2 rounded-full bg-[#fff] shadow-[0_0_10px_#fff]" />
    </span>
  );
}

/** Same bar without route state, shown while the client part streams in. */
function StaticBar() {
  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between rounded-full border border-white/10 bg-white/[0.03] py-2 pr-2 pl-3 backdrop-blur-md">
        <Link href="/" aria-label="arkivzk home" className="flex items-center gap-2.5 py-1">
          <LogoMark />
          <Wordmark />
        </Link>
        <Link href="/app" className="rounded-full bg-[#fff] px-5 py-2 text-sm font-semibold text-black">Open app →</Link>
      </div>
    </header>
  );
}

export function SiteHeader() {
  return (
    <Suspense fallback={<StaticBar />}>
      <NavLinks />
    </Suspense>
  );
}
