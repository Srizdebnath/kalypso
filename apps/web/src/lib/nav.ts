export type NavItem = { href: string; label: string; accent?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/docs", label: "Docs" },
  { href: "/archive", label: "Archive node" },
  { href: "/app", label: "Open app", accent: true },
];
