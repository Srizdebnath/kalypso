"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ITEMS } from "@/lib/nav";

export function NavLinks() {
  const pathname = usePathname();
  // the menu belongs to the page it was opened on, so navigating closes it
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const links = NAV_ITEMS.filter((i) => !i.accent);
  const cta = NAV_ITEMS.find((i) => i.accent);
  const isActive = (href: string) => !href.includes("#") && (pathname === href || pathname.startsWith(href + "/"));

  return (
    <>
      <nav className="hidden items-center gap-1 md:flex">
        {links.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={isActive(i.href) ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              isActive(i.href) ? "bg-white/10 text-white" : "text-[#c0c0c0] hover:text-white"
            }`}
          >
            {i.label}
          </Link>
        ))}
        {cta && (
          <Link href={cta.href} className="nb-btn bg-ink ml-2 px-5 py-2 text-sm">
            {cta.label}
          </Link>
        )}
      </nav>

      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-full border border-white/15 md:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpenOn(open ? null : pathname)}
      >
        <span className="relative block h-3 w-4">
          <span className={`absolute left-0 h-0.5 w-4 rounded bg-white transition-all ${open ? "top-1.5 rotate-45" : "top-0"}`} />
          <span className={`absolute left-0 h-0.5 w-4 rounded bg-white transition-all ${open ? "top-1.5 -rotate-45" : "top-2.5"}`} />
        </span>
      </button>

      {open && (
        <div className="glass absolute inset-x-3 top-[calc(100%+0.5rem)] rounded-3xl p-3 md:hidden" style={{ animation: "fade-up .3s both" }}>
          {links.map((i) => (
            <Link key={i.href} href={i.href} className="block rounded-2xl px-4 py-3 text-[#dcdcdc] hover:bg-white/5">
              {i.label}
            </Link>
          ))}
          {cta && (
            <Link href={cta.href} className="nb-btn bg-ink mt-2 w-full">
              {cta.label}
            </Link>
          )}
        </div>
      )}
    </>
  );
}
