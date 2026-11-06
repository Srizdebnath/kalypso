"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  listCollections,
  listRecords,
  retryShredPublish,
  shredAccount,
  shredEpoch,
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
const ACCOUNT_WORD = "DELETE EVERYTHING";

type Level = "records" | "epoch" | "account";
type Confirm = { level: Level; epoch?: string } | null;

const LEVELS: { level: Level; label: string }[] = [
  { level: "records", label: "Selected records" },
  { level: "epoch", label: "Whole month (epoch)" },
  { level: "account", label: "Entire account" },
];

export function ShredView() {
  const records = useAsync(listRecords);
  const { focusRecord, setFocusRecord } = useWallet();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(focusRecord ? [focusRecord] : []));
  const collections = useAsync(listCollections);
  const [level, setLevel] = useState<Level>("records");
  const [epochPick, setEpochPick] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ShredStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ShredReceiptView | null>(null);
  /** Shred finished but returned no receipt: keys destroyed, nothing on Arkiv to clean. */
  const [keysOnly, setKeysOnly] = useState(false);

  // One entry per month, summing collections (one per schema) in that epoch.
  const epochs = useMemo(() => {
    const m = new Map<string, { epoch: string; records: number; schemas: string[]; live: boolean }>();
    for (const c of collections.data ?? []) {
      const e = m.get(c.epoch) ?? { epoch: c.epoch, records: 0, schemas: [], live: false };
      e.records += c.records;
      e.schemas.push(c.schemaId);
      e.live = e.live || c.status === "live";
      m.set(c.epoch, e);
    }
    return [...m.values()].sort((a, b) => b.epoch.localeCompare(a.epoch));
  }, [collections.data]);
  const liveEpochs = epochs.filter((e) => e.live);
  const epoch = (liveEpochs.some((e) => e.epoch === epochPick) && epochPick) || liveEpochs[0]?.epoch || "";
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

  async function execute(fn: (onStep: (s: ShredStep[]) => void) => Promise<ShredReceiptView | null>) {
    setConfirm(null);
    setRunning(true);
    setSteps([]);
    setError(null);
    setReceipt(null);
    setKeysOnly(false);
    try {
      const r = await fn((s) => setSteps([...s]));
      if (r) setReceipt(r);
      else setKeysOnly(true);
      setSelected(new Set());
      setFocusRecord(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
      records.reload();
      collections.reload();
    }
  }

  function onConfirmed(c: NonNullable<Confirm>) {
    if (c.level === "records") {
      const keys = chosen;
      return execute((cb) => shredRecords(keys, cb));
    }
    if (c.level === "epoch" && c.epoch) {
      const e = c.epoch;
      return execute((cb) => shredEpoch(e, cb));
    }
    if (c.level === "account") return execute((cb) => shredAccount(cb));
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
          <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="Shred level">
            {LEVELS.map((l) => (
              <button
                key={l.level}
                type="button"
                role="tab"
                aria-selected={level === l.level}
                disabled={running}
                onClick={() => setLevel(l.level)}
                className={cx(
                  "border-[3px] border-ink px-2 py-2 text-sm font-bold",
                  level === l.level
                    ? l.level === "account"
                      ? "bg-danger shadow-brutal-sm"
                      : "bg-yellow shadow-brutal-sm"
                    : "bg-white hover:bg-paper",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          {level === "epoch" && (
            <EpochPanel
              loading={collections.loading && !collections.data}
              error={collections.error}
              onRetry={collections.reload}
              epochs={epochs}
              epoch={epoch}
              onPick={setEpochPick}
              running={running}
              onShred={() => setConfirm({ level: "epoch", epoch })}
            />
          )}

          {level === "account" && (
            <div className="space-y-4">
              <div className="nb-border bg-[#ffe1e1] p-4 text-sm">
                <p className="text-lg font-bold">Destroy everything this vault has ever written.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Every record key, every month&apos;s collection key and the blind-index keys are destroyed.</li>
                  <li>This vault&apos;s identity is destroyed too. You start from nothing afterwards.</li>
                  <li>Recovery kits you exported become useless for this data. Delete them anyway.</li>
                </ul>
              </div>
              <Button
                tone="danger"
                size="lg"
                className="w-full"
                disabled={running}
                onClick={() => setConfirm({ level: "account" })}
              >
                {running ? "Shredding…" : "Delete entire account"}
              </Button>
            </div>
          )}

          {level === "records" && (
          <>
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
                onClick={() => {
                  const keys = pending.map((r) => r.entityKey);
                  execute((cb) => retryShredPublish(keys, cb));
                }}
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
                            <Badge tone="white">epoch {r.epoch}</Badge>
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
                onClick={() => setConfirm({ level: "records" })}
              >
                {running ? "Shredding…" : `Delete forever (${chosen.length})`}
              </Button>
            </>
          )}
          </>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        {!running && steps.length === 0 && !receipt && !keysOnly && !error && (
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

        {keysOnly && (
          <div className="nb-card bg-lime p-5">
            <p className="text-2xl font-bold">Keys destroyed.</p>
            <p className="mt-1 text-sm">
              There was nothing left on Arkiv to delete, so no receipt entity was published.
            </p>
          </div>
        )}
      </div>

      {confirm?.level === "records" && (
        <ConfirmDialog
          word={CONFIRM_WORD}
          title={`Destroy ${chosen.length} record${chosen.length === 1 ? "" : "s"} forever?`}
          confirmLabel="Shred now"
          onCancel={() => setConfirm(null)}
          onConfirm={() => onConfirmed(confirm)}
        >
          <p>
            All key shares will be destroyed. After this, nobody (you, the guardians, or anyone
            holding an old copy of the chain) can decrypt {chosen.length === 1 ? "this record" : "these records"}.
          </p>
        </ConfirmDialog>
      )}
      {confirm?.level === "epoch" && (
        <ConfirmDialog
          word={CONFIRM_WORD}
          title={`Destroy every record from ${confirm.epoch}?`}
          confirmLabel="Shred the month"
          onCancel={() => setConfirm(null)}
          onConfirm={() => onConfirmed(confirm)}
        >
          <p>
            The month&apos;s collection key is destroyed. Every record from {confirm.epoch} dies at
            once, including records created on your other devices.
          </p>
        </ConfirmDialog>
      )}
      {confirm?.level === "account" && (
        <ConfirmDialog
          word={ACCOUNT_WORD}
          title="Delete your entire account?"
          confirmLabel="Delete everything"
          onCancel={() => setConfirm(null)}
          onConfirm={() => onConfirmed(confirm)}
        >
          <p>
            All keys and this vault&apos;s identity are destroyed. Nothing you have written can be
            decrypted again, by anyone.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ConfirmDialog({
  word,
  title,
  confirmLabel,
  children,
  onCancel,
  onConfirm,
}: {
  word: string;
  title: string;
  confirmLabel: string;
  children: ReactNode;
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

  const ok = typed.trim().toUpperCase() === word;

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
            {title}
          </h2>
        </div>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onConfirm();
          }}
        >
          {children}
          <p className="text-sm">
            It does <strong>not</strong> un-share anything someone already decrypted.
          </p>
          <div>
            <label className="nb-label" htmlFor="confirm-word">
              Type {word} to confirm
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
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EpochPanel({
  loading,
  error,
  onRetry,
  epochs,
  epoch,
  onPick,
  running,
  onShred,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  epochs: { epoch: string; records: number; schemas: string[]; live: boolean }[];
  epoch: string;
  onPick: (e: string) => void;
  running: boolean;
  onShred: () => void;
}) {
  const current = epochs.find((e) => e.epoch === epoch);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Destroys the month&apos;s collection key: every record of that month dies at once, even ones
        on other devices.
      </p>
      {loading && <Loading label="Loading collections" />}
      {error && <ErrorBox title="Could not load collections" error={error} onRetry={onRetry} />}
      {!loading && !error && epochs.length === 0 && (
        <div className="nb-border border-dashed bg-white p-5 text-center font-bold">No collections yet.</div>
      )}
      {epochs.length > 0 && (
        <ul className="space-y-2">
          {epochs.map((e) => (
            <li key={e.epoch}>
              <label
                className={cx(
                  "flex items-center gap-3 border-[3px] border-ink p-3",
                  !e.live ? "cursor-not-allowed bg-white opacity-60" : "cursor-pointer",
                  e.live && epoch === e.epoch ? "bg-danger/30 shadow-brutal-sm" : e.live && "bg-white hover:bg-paper",
                )}
              >
                <input
                  type="radio"
                  name="epoch"
                  className="h-5 w-5 accent-black"
                  checked={e.live && epoch === e.epoch}
                  disabled={!e.live || running}
                  onChange={() => onPick(e.epoch)}
                />
                <span className="font-mono text-lg font-bold">{e.epoch}</span>
                <span className="text-sm">
                  {e.records} record{e.records === 1 ? "" : "s"} · {e.schemas.join(", ")}
                </span>
                {!e.live && <Badge tone="ink">✕ shredded</Badge>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button tone="danger" size="lg" className="w-full" disabled={!current?.live || running} onClick={onShred}>
        {running ? "Shredding…" : current ? `Shred month ${current.epoch}` : "Shred month"}
      </Button>
    </div>
  );
}
