import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "./nav-links";
import { NAV_ITEMS } from "@/lib/nav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-ink bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="group flex items-center gap-2" aria-label="arkivzk home">
          <span className="nb-border grid h-10 w-10 place-items-center bg-ink font-mono text-lg font-bold text-yellow shadow-brutal-sm transition-transform group-hover:-rotate-6">
            zk
          </span>
          <span className="text-2xl font-bold tracking-tight">arkivzk</span>
        </Link>
        <Suspense
          fallback={
            <nav className="flex flex-wrap gap-2">
              {NAV_ITEMS.map((i) => (
                <Link key={i.href} href={i.href} className="nb-btn bg-white px-3 py-1.5 text-xs">
                  {i.label}
                </Link>
              ))}
            </nav>
          }
        >
          <NavLinks />
        </Suspense>
      </div>
    </header>
  );
}
