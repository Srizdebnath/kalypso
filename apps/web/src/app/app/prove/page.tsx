import type { Metadata } from "next";
import { ProveView } from "./prove-view";

export const metadata: Metadata = { title: "Prove" };

// Rendered only after the client-side wallet gate passes (see ../app-shell.tsx).
export const instant = false;

export default function ProvePage() {
  return <ProveView />;
}
