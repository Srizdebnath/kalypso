"use client";

import { useEffect, useState } from "react";

/** "On this page" list that highlights the section in view. */
export function Toc({ headings }: { headings: { id: string; text: string; depth: number }[] }) {
  const [active, setActive] = useState(headings[0]?.id);
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [headings]);
  return (
    <ul className="space-y-1 border-l border-white/10 text-[0.82rem]">
      {headings.map((h) => (
        <li key={h.id}>
          <a
            href={`#${h.id}`}
            className={`-ml-px block border-l py-1 leading-snug transition-colors ${h.depth === 3 ? "pl-6" : "pl-3"} ${
              active === h.id ? "border-[#a3a3a3] text-white" : "border-transparent text-[#999999] hover:text-white"
            }`}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
