"use client";

import { useState } from "react";
import { Button } from "./ui";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      tone={copied ? "lime" : "white"}
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

export function HashLine({ value, label }: { value: string; label?: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <code className="min-w-0 break-all font-mono text-sm">{value}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}
