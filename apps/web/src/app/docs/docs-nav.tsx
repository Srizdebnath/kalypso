"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { splitTitle, type DocLink } from "@/lib/docs-groups";

export function DocsNav({ groups }: { groups: { title: string; items: DocLink[] }[] }) {
  const pathname = usePathname();
  // the menu belongs to the page it was opened on, so navigating closes it
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const current = groups.flatMap((g) => g.items).find((i) => i.href === pathname);

  const list = (
    <div className="space-y-6">
      <Link
        href="/docs"
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${pathname === "/docs" ? "bg-white/10 text-white" : "text-[#c0c0c0] hover:text-white"}`}
      >
        <span className="text-[#a3a3a3]">◆</span> Overview
      </Link>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-3 text-[0.68rem] font-semibold tracking-[0.18em] text-[#7a7a7a] uppercase">{g.title}</p>
          <ul className="space-y-0.5 border-l border-white/10">
            {g.items.map((i) => {
              const active = pathname === i.href;
              const { num, name } = splitTitle(i.label);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={`-ml-px flex gap-2 border-l py-1.5 pr-2 pl-3 text-sm leading-snug transition-colors ${
                      active ? "border-[#a3a3a3] text-white" : "border-transparent text-[#a3a3a3] hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {num && <span className="font-mono text-xs text-[#7a7a7a] pt-0.5">{num}</span>}
                    <span>{name.split(":")[0]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <nav aria-label="Documentation">
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpenOn(open ? null : pathname)}
          aria-expanded={open}
          className="glass flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm text-white"
        >
          <span className="min-w-0 truncate">{current ? splitTitle(current.label).name : "Documentation"}</span>
          <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {open && <div className="glass mt-2 rounded-2xl p-3">{list}</div>}
      </div>
      <div className="hidden lg:block">{list}</div>
    </nav>
  );
}
