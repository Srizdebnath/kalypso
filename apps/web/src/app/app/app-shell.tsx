"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button, Card, ErrorBox, Loading, cx } from "@/components/ui";
import { shortHex } from "@/lib/format";
import { WalletProvider, useWallet } from "./wallet-context";

const TABS = [
  { href: "/app", label: "Vault", tone: "bg-cyan" },
  { href: "/app/prove", label: "Prove", tone: "bg-pink" },
  { href: "/app/shred", label: "Shred", tone: "bg-lime" },
  { href: "/app/query", label: "Query", tone: "bg-violet" },
  { href: "/app/settings", label: "Settings", tone: "bg-yellow" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <ShellHeader />
        <Gate>{children}</Gate>
      </div>
    </WalletProvider>
  );
}

function ShellHeader() {
  const pathname = usePathname();
  const { address } = useWallet();
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <nav className="glass flex flex-wrap gap-1 rounded-full p-1.5" aria-label="App sections">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300",
                active
                  ? "bg-gradient-to-b from-white to-[#e5e5e5] text-[#0b0b0b] shadow-[0_0_24px_-4px_rgb(147_147_147/0.8)]"
                  : "text-[#c0c0c0] hover:bg-white/5 hover:text-white",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="glass flex items-center gap-2 rounded-full px-4 py-2 font-mono text-sm">
        <span className={cx("h-2 w-2 rounded-full", address ? "bg-[#cbcbcb] shadow-[0_0_8px_#cbcbcb]" : "bg-[#ff5c7a]")} />
        {address ? shortHex(address, 6, 4) : "no wallet"}
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { address, checking, connecting, checkError, connectError, connect } = useWallet();

  if (address) return <>{children}</>;

  return (
    <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
      <Card tone="yellow" className="p-8">
        <h1 className="text-4xl font-bold">Connect a wallet</h1>
        <p className="mt-3 max-w-lg">
          Your wallet signs the Arkiv transactions. Encryption keys are created on this device
          and never touch the chain.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button tone="ink" size="lg" onClick={connect} disabled={connecting || checking}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </Button>
          {checking && <Loading label="Checking for an existing session" />}
        </div>
        <div className="mt-6 space-y-3">
          {connectError && <ErrorBox title="Could not connect" error={connectError} />}
          {checkError && !connectError && (
            <ErrorBox title="Could not check wallet session" error={checkError} />
          )}
        </div>
      </Card>
      <Card>
        <h2 className="text-xl font-bold">What you can do here</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li>
            <strong className="text-[#b6b6b6]">Vault</strong> store an encrypted record (and an
            optional file on Swarm), list and decrypt your records.
          </li>
          <li>
            <strong className="text-[#a2a2a2]">Prove</strong> prove a claim about a field and share a
            link anyone can verify.
          </li>
          <li>
            <strong className="text-[#cbcbcb]">Shred</strong> destroy the keys and get a signed
            receipt.
          </li>
          <li>
            <strong className="text-[#9d9d9d]">Query</strong> see the plan and queries Arkiv runs
            for your data.
          </li>
          <li>
            <strong className="text-[#d5d5d5]">Settings</strong> choose who signs new records, and
            export or restore a recovery kit.
          </li>
        </ul>
        <p className="mt-4 text-sm">
          No wallet needed to <Link className="font-bold underline" href="/archive">inspect the archive node</Link>{" "}
          or open a verify / receipt link.
        </p>
      </Card>
    </div>
  );
}
