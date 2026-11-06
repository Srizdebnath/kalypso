"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  listRecords,
  retryShredPublish,
  shredRecords,
  type ShredReceiptView,
  type ShredStep,
} from "@/lib/arkivzk-client";
import { errorMessage, formatDate } from "@/lib/format";
import { expiryLabel } from "@/lib/records";
import { useAsync } from "@/lib/use-async";
import { Badge, Button, Card, ErrorBox, Loading, cx } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { StepList } from "@/components/step-list";
import { ReceiptCard } from "@/components/receipt-card";
import { useWallet } from "../wallet-context";

const CONFIRM_WORD = "SHRED";

export function ShredView() {
  const records = useAsync(listRecords);
  const { focusRecord, setFocusRecord } = useWallet();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(focusRecord ? [focusRecord] : []));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ShredStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ShredReceiptView | null>(null);
  const [now] = useState(() => Date.now());

  const shreddable = (records.data ?? []).filter((r) => r.status !== "shredded" && !r.pendingShred);
  const pending = (records.data ?? []).filter((r) => r.pendingShred);
  const chosen = shreddable.filter((r) => selected.has(r.entityKey)).map((r) => r.entityKey);

  function toggle(k: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  async function run(retryKeys?: string[]) {
    const keys = retryKeys ?? chosen;
    setConfirmOpen(false);
    setRunning(true);
    setSteps([]);
    setError(null);
    setReceipt(null);
    try {
      const onStep = (s: ShredStep[]) => setSteps([...s]);
      const r = retryKeys ? await retryShredPublish(keys, onStep) : await shredRecords(keys, onStep);
      setReceipt(r);
      setSelected(new Set());
      setFocusRecord(null);
      records.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="self-start p-0">
        <div className="border-b-[3px] border-ink bg-lime p-5">
          <p className="font-mono text-xs font-bold uppercase">crypto-shredding</p>
          <h2 className="text-2xl font-bold">Delete forever</h2>
          <p className="mt-1 text-sm">
            Destroys every key share (device + both guardians), deletes the entities on Arkiv and
            publishes a signed ShredReceipt. Old copies of the ciphertext stay out there, but nothing
            can open them.
          </p>
        </div>
        <div className="p-5">
          {records.loading && !records.data && <Loading label="Loading records" />}
          {records.error && (
            <ErrorBox title="Could not load records" error={records.error} onRetry={records.reload} />
          )}
          {pending.length > 0 && (
            <div className="nb-border mb-5 bg-[#ffe1e1] p-4">
              <p className="font-bold">
                Keys destroyed, receipt not yet published ({pending.length})
              </p>
              <p className="mt-1 text-sm">
                The key shares are gone, so the data is already unreadable. The Arkiv delete and the
                public ShredReceipt didn&apos;t complete. Retry to publish them.
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {pending.map((r) => (
                  <li key={r.entityKey} className="break-all">
                    {r.entityKey}
                  </li>
                ))}
              </ul>
              <Button
                tone="danger"
                size="sm"
                className="mt-3"
                disabled={running}
                onClick={() => run(pending.map((r) => r.entityKey))}
              >
                {running ? "Publishing…" : "Retry publishing receipt"}
              </Button>
            </div>
          )}
          {records.data && shreddable.length === 0 && pending.length === 0 && (
            <div className="nb-border border-dashed bg-white p-5 text-center">
              <p className="font-bold">Nothing left to shred.</p>
              <Link href="/app" className="nb-btn mt-3 bg-cyan">
                Back to Vault
              </Link>
            </div>
          )}
          {shreddable.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="nb-label m-0">Pick records</p>
                <button
                  type="button"
                  className="font-mono text-xs font-bold underline"
                  disabled={running}
                  onClick={() =>
                    setSelected(
                      chosen.length === shreddable.length ? new Set() : new Set(shreddable.map((r) => r.entityKey)),
                    )
                  }
                >
                  {chosen.length === shreddable.length ? "select none" : "select all"}
                </button>
              </div>
              <ul className="space-y-2">
                {shreddable.map((r) => {
                  const on = selected.has(r.entityKey);
                  const exp = expiryLabel(r, now);
                  return (
                    <li key={r.entityKey}>
                      <label
                        className={cx(
                          "flex cursor-pointer items-start gap-3 border-[3px] border-ink p-3",
                          on ? "bg-danger/30 shadow-brutal-sm" : "bg-white hover:bg-paper",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5 accent-black"
                          checked={on}
                          disabled={running}
                          onChange={() => toggle(r.entityKey)}
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={r.status} />
                            <Badge>{r.schemaId}</Badge>
                            {r.swarmRef && <Badge tone="violet">+ file</Badge>}
                            {exp && <span className="font-mono text-xs">{exp}</span>}
                          </span>
                          <span className="mt-1 block break-all font-mono text-xs">{r.entityKey}</span>
                          <span className="block text-xs opacity-70">created {formatDate(r.createdAt)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <Button
                tone="danger"
                size="lg"
                className="mt-5 w-full"
                disabled={chosen.length === 0 || running}
                onClick={() => setConfirmOpen(true)}
              >
                {running ? "Shredding…" : `Delete forever (${chosen.length})`}
              </Button>
            </>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        {!running && steps.length === 0 && !receipt && !error && (
          <Card>
            <h3 className="text-xl font-bold">Before you shred</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
              <li>There is no undo. Not for you, not for us, not for anyone.</li>
              <li>Anyone who decrypted the record before now keeps what they saw.</li>
              <li>If you exported or backed up key material yourself, destroy that too.</li>
              <li>Metadata already on Arkiv (timestamps, schema id, size bucket) stays in history.</li>
              <li>Proofs made from this record will show as revoked on their verify pages.</li>
            </ul>
          </Card>
        )}

        {(running || steps.length > 0) && (
          <div>
            <h3 className="mb-2 text-xl font-bold">Shred progress</h3>
            {steps.length === 0 ? <Loading label="Starting shred" /> : <StepList steps={steps} />}
          </div>
        )}

        {error && <ErrorBox title="Shred failed" error={error} />}

        {receipt && <ReceiptCard receipt={receipt} />}
      </div>

      {confirmOpen && (
        <ConfirmDialog count={chosen.length} onCancel={() => setConfirmOpen(false)} onConfirm={() => run()} />
      )}
    </div>
  );
}

function ConfirmDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ok = typed.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shred-title"
      onClick={onCancel}
    >
      <div className="nb-card w-full max-w-lg bg-white p-0 shadow-brutal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="border-b-[3px] border-ink bg-danger p-5">
          <p className="font-mono text-xs font-bold uppercase">irreversible</p>
          <h2 id="shred-title" className="text-3xl font-bold">
            Destroy {count} record{count === 1 ? "" : "s"} forever?
          </h2>
        </div>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onConfirm();
          }}
        >
          <p>
            All key shares will be destroyed. After this, nobody (you, the guardians, or anyone
            holding an old copy of the chain) can decrypt {count === 1 ? "this record" : "these records"}.
          </p>
          <p className="text-sm">
            It does <strong>not</strong> un-share anything someone already decrypted.
          </p>
          <div>
            <label className="nb-label" htmlFor="confirm-word">
              Type {CONFIRM_WORD} to confirm
            </label>
            <input
              id="confirm-word"
              ref={input}
              className="nb-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" tone="white" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" tone="danger" disabled={!ok}>
              Shred now
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
