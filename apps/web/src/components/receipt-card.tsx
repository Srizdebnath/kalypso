"use client";

import Link from "next/link";
import { useState } from "react";
import { erasureCertificate, type ShredReceiptView } from "@/lib/arkivzk-client";
import { downloadJson, errorMessage, formatDate } from "@/lib/format";
import { Badge, Button, ErrorBox, KV } from "./ui";
import { HashLine } from "./copy-button";

function CertificateButton({ receiptKey }: { receiptKey: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        tone="yellow"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const cert = await erasureCertificate(receiptKey);
            downloadJson(`arkivzk-erasure-certificate-${receiptKey.slice(0, 12)}.json`, cert);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : "Download erasure certificate (JSON)"}
      </Button>
      {error && <ErrorBox title="Could not build certificate" error={error} />}
    </div>
  );
}

export function ReceiptCard({ receipt, showLink = true }: { receipt: ShredReceiptView; showLink?: boolean }) {
  const allValid = receipt.attestations.length > 0 && receipt.attestations.every((a) => a.valid);
  return (
    <div className="nb-card p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-ink bg-ink p-5 text-paper">
        <div>
          <p className="font-mono text-xs font-bold uppercase text-yellow">ShredReceipt · level {receipt.level}</p>
          <p className="text-2xl font-bold">Keys destroyed.</p>
          <p className="text-sm opacity-80">{formatDate(receipt.createdAt)}</p>
        </div>
        {allValid ? (
          <Badge tone="lime">✓ all {receipt.attestations.length} signatures valid</Badge>
        ) : (
          <Badge tone="danger">✕ signature check failed</Badge>
        )}
      </div>
      <div className="space-y-5 p-5">
        <div className="nb-border flex flex-wrap items-center justify-between gap-3 bg-lime p-4">
          <div>
            <p className="nb-label m-0">Key shares remaining, at most</p>
            <p className="text-sm">Decryption needs 2 of 3 shares.</p>
          </div>
          <p className="font-mono text-4xl font-bold">{receipt.keySharesRemainingAtMost}</p>
        </div>
        <dl>
          <KV k="Receipt entity"><HashLine value={receipt.receiptKey} /></KV>
          {receipt.txHash && receipt.txHash !== "0x" && <KV k="Tx hash"><HashLine value={receipt.txHash} /></KV>}
        </dl>

        <div>
          <p className="nb-label">Deleted entities ({receipt.deletedEntities.length})</p>
          <ul className="nb-border divide-y-2 divide-ink bg-paper font-mono text-xs">
            {receipt.deletedEntities.map((k) => (
              <li key={k} className="break-all px-3 py-2">{k}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="nb-label">Guardian attestations</p>
          <ul className="space-y-3">
            {receipt.attestations.map((a, i) => (
              <li key={i} className={`nb-border p-3 ${a.valid ? "bg-lime" : "bg-danger"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{a.guardian}</p>
                  <Badge tone="white">{a.valid ? "✓ valid signature" : "✕ invalid signature"}</Badge>
                </div>
                <dl className="mt-2 rounded-lg bg-white/5 px-2">
                  <KV k="Public key">{a.publicKey}</KV>
                  <KV k="Signature">{a.signature}</KV>
                </dl>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <CertificateButton receiptKey={receipt.receiptKey} />
          {showLink && (
            <Link href={`/receipt/${receipt.receiptKey}`} className="nb-btn bg-white">
              Public receipt page →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
