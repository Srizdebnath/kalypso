"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { splitTitle, type DocLink } from "@/lib/docs-groups";

const short = (label: string) => splitTitle(label).name.split(":")[0].replace(/\s*\(.*\)$/, "");

export function DocsNav({ groups }: { groups: { title: string; items: DocLink[] }[] }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const current = groups.flatMap((g) => g.items).find((i) => i.href === pathname);

  const item = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={`relative -ml-px flex items-center gap-2 rounded-md py-1.5 pr-2 pl-5 text-[0.86rem] transition-colors ${
            active ? "bg-[#f4f4f5] font-medium text-[#0a0a0a]" : "text-[#525252] hover:text-[#0a0a0a]"
          }`}
        >
          <span className={`absolute left-[-3px] h-1.5 w-1.5 rounded-full ${active ? "bg-[#0a0a0a]" : "bg-transparent"}`} />
          {label}
        </Link>
      </li>
    );
  };

  const list = (
    <div className="space-y-6">
      <div>
        <p className="mb-1.5 text-[0.8rem] font-medium text-[#8a8a8a]">Overview</p>
        <ul className="ml-1 border-l border-[#e5e5e5]">{item("/docs", "Introduction")}</ul>
      </div>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 text-[0.8rem] font-medium text-[#8a8a8a]">{g.title}</p>
          <ul className="ml-1 space-y-0.5 border-l border-[#e5e5e5]">{g.items.map((i) => item(i.href, short(i.label)))}</ul>
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
          className="flex w-full items-center justify-between rounded-lg border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#171717]"
        >
          <span className="min-w-0 truncate">{current ? short(current.label) : "Introduction"}</span>
          <span className={`text-[#737373] transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {open && <div className="mt-2 rounded-lg border border-[#e5e5e5] p-4">{list}</div>}
      </div>
      <div className="hidden lg:block">{list}</div>
    </nav>
  );
}
