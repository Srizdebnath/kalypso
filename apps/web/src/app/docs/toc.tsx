"use client";

import { useEffect, useState } from "react";

/** "On this page" list that marks the section in view. */
export function Toc({ headings }: { headings: { id: string; text: string; depth: number }[] }) {
  const [active, setActive] = useState(headings[0]?.id);
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-70px 0px -65% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [headings]);
  return (
    <ul className="border-l border-[#e5e5e5] text-[0.8rem]">
      {headings.map((h) => (
        <li key={h.id}>
          <a
            href={`#${h.id}`}
            className={`-ml-px block border-l-2 py-1 leading-snug transition-colors ${h.depth === 3 ? "pl-6" : "pl-3"} ${
              active === h.id ? "border-[#0a0a0a] font-medium text-[#0a0a0a]" : "border-transparent text-[#737373] hover:text-[#0a0a0a]"
            }`}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
