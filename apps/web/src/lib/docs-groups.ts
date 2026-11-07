export type DocLink = { href: string; label: string; file?: string };

const DESC: Record<string, string> = {
  "00": "Install, configure, run the services and use the SDK in ten minutes.",
  "01": "The pitch, the threat model, and what we do and don't promise.",
  "02": "Package layout, data flow and every architecture diagram.",
  "03": "Commitments, Noir circuits, proof entities and public verification.",
  "04": "Key hierarchy, 2-of-3 custody, shred levels and receipts.",
  "05": "What was built first and why, given hackathon time.",
  "06": "Every SDK method with runnable code.",
  "07": "Complexity, live measurements and before/after tables.",
  "08": "Why encrypted queries live on top of Arkiv, and what each index leaks.",
  api: "Functions the web app calls, generated from the client source.",
};

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Start here", keys: ["00", "01", "05"] },
  { title: "Design", keys: ["02", "03", "04"] },
  { title: "Build", keys: ["06", "api"] },
  { title: "Deep dive", keys: ["07", "08"] },
];

const keyOf = (href: string) => (href === "/docs/api" ? "api" : href.split("/").pop()!.slice(0, 2));

export function groupDocs(items: DocLink[]) {
  const used = new Set<string>();
  const groups = GROUPS.map((g) => ({
    title: g.title,
    items: g.keys.flatMap((k) => items.filter((i) => keyOf(i.href) === k)).map((i) => (used.add(i.href), i)),
  }));
  const rest = items.filter((i) => !used.has(i.href));
  if (rest.length) groups.push({ title: "More", items: rest });
  return groups.filter((g) => g.items.length);
}

export const describe = (href: string) => DESC[keyOf(href)] ?? "";

/** "07 · Performance: complexity…" -> { num: "07", name: "Performance: complexity…" } */
export function splitTitle(t: string) {
  const m = t.match(/^(\d+)\s*·\s*(.+)$/);
  return m ? { num: m[1], name: m[2] } : { num: "", name: t };
}
