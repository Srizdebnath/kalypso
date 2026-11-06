import type { Metadata } from "next";
import { ShredView } from "./shred-view";

export const metadata: Metadata = { title: "Shred" };

// Rendered only after the client-side wallet gate passes (see ../app-shell.tsx).
export const instant = false;

export default function ShredPage() {
  return <ShredView />;
}
