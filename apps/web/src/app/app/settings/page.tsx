import type { Metadata } from "next";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings · recovery" };

// Rendered only after the client-side wallet gate passes (see ../app-shell.tsx).
export const instant = false;

export default function SettingsPage() {
  return <SettingsView />;
}
