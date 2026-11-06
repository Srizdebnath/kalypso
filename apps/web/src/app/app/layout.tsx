import type { Metadata } from "next";
import { AppShell } from "./app-shell";

export const metadata: Metadata = { title: "App" };

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return <AppShell>{children}</AppShell>;
}
