"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_ITEMS } from "@/lib/nav";
import { LogoMark, Wordmark } from "./site-header";

export function NavLinks() {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) => !href.includes("#") && (pathname === href || pathname.startsWith(href + "/"));
  const inApp = pathname.startsWith("/app");

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div
        className={`relative z-[60] mx-auto flex items-center justify-between gap-3 rounded-full border py-2 pr-2 pl-3 transition-all duration-500 ${
          scrolled
            ? "max-w-5xl border-white/15 bg-black/70 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.04)] backdrop-blur-xl"
            : "max-w-6xl border-white/10 bg-white/[0.03] backdrop-blur-md"
        }`}
      >
        <Link href="/" aria-label="arkivzk home" className="flex items-center gap-2.5 rounded-full py-1 pr-2">
          <LogoMark />
          <Wordmark />
        </Link>

        <nav className="hidden items-center rounded-full border border-white/10 bg-white/[0.03] p-1 md:flex" aria-label="Main">
          {NAV_ITEMS.map((i) => {
            const active = isActive(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-4 py-1.5 text-sm transition-all duration-300 ${
                  active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 font-mono text-[0.68rem] tracking-wider text-white/60 uppercase lg:flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#fff] opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-[#fff]" />
            </span>
            Rabdi live
          </span>
          <Link
            href="/app"
            className={`group hidden items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300 sm:inline-flex ${
              inApp ? "border border-white/20 text-white" : "bg-[#fff] text-black shadow-[0_0_24px_-6px_rgb(255_255_255/0.7)] hover:shadow-[0_0_32px_-4px_rgb(255_255_255/0.9)]"
            }`}
          >
            {inApp ? "In the app" : "Open app"}
            <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
          </Link>
          <button
            type="button"
            className="relative z-[60] grid h-10 w-10 place-items-center rounded-full border border-white/15 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpenOn(open ? null : pathname)}
          >
            <span className="relative block h-3 w-4">
              <span className={`absolute left-0 h-0.5 w-4 rounded bg-[#fff] transition-all duration-300 ${open ? "top-1.5 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 h-0.5 w-4 rounded bg-[#fff] transition-all duration-300 ${open ? "top-1.5 -rotate-45" : "top-2.5"}`} />
            </span>
          </button>
        </div>
      </div>

      {/* mobile: full-screen menu */}
      <div
        className={`fixed inset-0 z-[55] flex flex-col justify-between bg-black/95 px-6 pt-28 pb-10 backdrop-blur-xl transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <nav className="space-y-1" aria-label="Mobile">
          {[{ href: "/", label: "Home" }, ...NAV_ITEMS, { href: "/app", label: "Open app" }].map((i, n) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={() => setOpenOn(null)}
              className="flex items-center justify-between border-b border-white/10 py-4 text-3xl font-semibold text-white"
              style={open ? { animation: `fade-up .5s ${n * 60}ms both` } : undefined}
            >
              {i.label}
              <span className="text-lg text-white/40">→</span>
            </Link>
          ))}
        </nav>
        <p className="font-mono text-xs text-white/40">Arkiv Rabdi · chain 7794095</p>
      </div>
    </header>
  );
}
