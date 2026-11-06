import type { Metadata } from "next";
import { QueryView } from "./query-view";

export const metadata: Metadata = { title: "Query explorer" };

// Rendered only after the client-side wallet gate passes (see ../app-shell.tsx).
export const instant = false;

export default function QueryPage() {
  return <QueryView />;
}
