"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2">
      {NAV_ITEMS.map((i) => {
        const active = pathname === i.href || pathname.startsWith(i.href + "/");
        const bg = active ? "bg-yellow" : i.accent ? "bg-lime" : "bg-white";
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`nb-btn px-3 py-1.5 text-xs ${bg}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
