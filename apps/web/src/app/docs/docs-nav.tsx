"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DocsNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="nb-card p-0" aria-label="Documentation">
      <div className="border-b-[3px] border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase text-yellow">
        <Link href="/docs">docs/</Link>
      </div>
      <ul>
        {items.map((i) => {
          const active = pathname === i.href;
          return (
            <li key={i.href} className="border-b-2 border-ink last:border-b-0">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`block px-4 py-2.5 text-sm font-bold transition-colors ${
                  active ? "bg-yellow" : "hover:bg-cyan"
                }`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
