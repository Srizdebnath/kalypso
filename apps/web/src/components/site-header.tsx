import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "./nav-links";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[0.95rem] font-bold tracking-[0.28em] text-white ${className}`}>
      ARKIV<span className="text-[#a3a3a3]">ZK</span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-3 z-50 px-3 sm:top-4 sm:px-4">
      <div className="glass mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full py-2 pr-2 pl-5 shadow-[0_10px_40px_-12px_rgb(67_67_67/0.6)]">
        <Link href="/" aria-label="arkivzk home" className="flex items-center gap-2.5">
          <span className="relative grid h-7 w-7 place-items-center">
            <span className="absolute inset-0 rounded-full border border-[#adadad] shadow-[0_0_14px_rgb(147_147_147/0.9)]" />
            <span className="h-2 w-2 rounded-full bg-[#e5e5e5] shadow-[0_0_10px_#fff]" />
          </span>
          <Wordmark />
        </Link>
        <Suspense fallback={<span className="h-9" />}>
          <NavLinks />
        </Suspense>
      </div>
    </header>
  );
}
