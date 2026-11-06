"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  expiringSoon,
  reminderIcsUrl,
  renewRecords,
  searchRecords,
  searchRange,
  countRecords,
  childrenOf,
  type FieldValue,
  type LocalRecord,
} from "@/lib/arkivzk-client";
import { errorMessage, formatDate } from "@/lib/format";
import { expiryLabel, expiresWithin } from "@/lib/records";
import { useAsync, type AsyncState } from "@/lib/use-async";
import { Badge, Button, ErrorBox, Loading, cx } from "@/components/ui";
import { HashLine } from "@/components/copy-button";
import { StatusBadge } from "@/components/status-badge";
import { StepLog } from "@/components/step-list";
import { useWallet } from "./wallet-context";

const DAY = 86_400;
const RENEW_OPTIONS = [1, 7, 30, 180];
const SOON_DAYS = 7;
const REMINDER_DAYS_BEFORE = 1;

export function RecordsPanel({
  state,
  selected,
  onSelect,
  schemaId,
  searchFields,
}: {
  state: AsyncState<LocalRecord[]>;
  selected: string | null;
  onSelect: (k: string) => void;
  schemaId: string;
  searchFields: { name: string; numeric?: boolean }[];
}) {
  const router = useRouter();
  const { setFocusRecord } = useWallet();
  const now = useNow();
  const { data, error, loading, reload } = state;

  // Re-ask the library whenever the record list changes.
  const version = (data ?? []).map((r) => `${r.entityKey}:${r.expiresAtBlock}:${r.status}`).join("|");
  const soon = useAsync(() => expiringSoon(SOON_DAYS), version);

  const [renewSel, setRenewSel] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<SearchResult | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const renewable = (data ?? []).filter((r) => r.status === "live");
  const chosen = renewable.filter((r) => renewSel.has(r.entityKey)).map((r) => r.entityKey);

  function toggle(k: string) {
    setRenewSel((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  function renewOne(k: string) {
    setRenewSel(new Set([k]));
    barRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">My records</h2>
        <Button tone="white" size="sm" onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </div>

      {soon.data && soon.data.length > 0 && (
        <div className="nb-border mb-4 flex flex-wrap items-center justify-between gap-3 bg-yellow p-4 shadow-brutal-sm">
          <p className="font-bold">
            ⏰ {soon.data.length} record{soon.data.length === 1 ? "" : "s"} expire
            {soon.data.length === 1 ? "s" : ""} within {SOON_DAYS} days
          </p>
          <Button
            size="sm"
            tone="ink"
            onClick={() => {
              setRenewSel(new Set(soon.data!.map((r) => r.entityKey)));
              barRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            Select them for renewal
          </Button>
        </div>
      )}
      {soon.error && data && (
        <div className="mb-4">
          <ErrorBox title="Could not check expiring records" error={soon.error} onRetry={soon.reload} />
        </div>
      )}

      <div ref={barRef}>
        {chosen.length > 0 && (
          <RenewBar keys={chosen} onDone={reload} onClear={() => setRenewSel(new Set())} />
        )}
      </div>

      <SearchBox schemaId={schemaId} fields={searchFields} result={search} onResult={setSearch} />

      {search && data && (
        <p className="mb-3 text-sm">
          Showing {data.filter((r) => search.keys.has(r.entityKey)).length} of {data.length} records
          matching <strong>{search.label}</strong>
          {search.keys.size > data.filter((r) => search.keys.has(r.entityKey)).length &&
            ` (${search.keys.size} matches on Arkiv in total)`}
          .
        </p>
      )}

      {loading && !data && <Loading label="Loading records" />}
      {error && <ErrorBox title="Could not load records" error={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <div className="nb-border border-dashed bg-white p-6 text-center">
          <p className="font-bold">No records yet.</p>
          <p className="text-sm">Create one with the form.</p>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.filter((r) => !search || search.keys.has(r.entityKey)).map((r) => {
            const exp = expiryLabel(r, now);
            const urgent = expiresWithin(r, now, DAY);
            const live = r.status === "live";
            return (
              <li
                key={r.entityKey}
                className={cx(
                  "nb-border bg-white p-4 transition-shadow",
                  selected === r.entityKey && "shadow-brutal",
                  r.status === "shredded" &&
                    "bg-[repeating-linear-gradient(45deg,#fff,#fff_10px,#f1f1f1_10px,#f1f1f1_20px)]",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {live && (
                    <input
                      type="checkbox"
                      aria-label="Select for renewal"
                      className="h-5 w-5 accent-black"
                      checked={renewSel.has(r.entityKey)}
                      onChange={() => toggle(r.entityKey)}
                    />
                  )}
                  <StatusBadge status={r.status} />
                  {r.pendingShred && <Badge tone="danger">receipt pending</Badge>}
                  <Badge>{r.schemaId}</Badge>
                  <Badge tone="white">epoch {r.epoch}</Badge>
                  {r.signer === "wallet" ? (
                    <Badge tone="cyan">owned by your wallet</Badge>
                  ) : (
                    <Badge tone="pink">one-time signer (unlinkable)</Badge>
                  )}
                  {r.swarmRef && <Badge tone="violet">+ file</Badge>}
                  {r.rangeField && <Badge tone="white">range: {r.rangeField}</Badge>}
                  {r.parents.map((p) => (
                    <Badge key={p.entityKey} tone="violet">↳ {p.relation} of {p.entityKey.slice(0, 8)}…</Badge>
                  ))}
                  {exp && (
                    <span
                      className={cx(
                        "border-2 border-ink px-1.5 font-mono text-xs font-bold tabular-nums",
                        urgent ? "bg-danger" : "bg-paper",
                      )}
                    >
                      {exp}
                    </span>
                  )}
                </div>
                <p className="mt-2 break-all font-mono text-sm">{r.entityKey}</p>
                <p className="mt-1 text-xs opacity-70">
                  created {formatDate(r.createdAt)} · fields: {r.fieldNames.join(", ") || "none"}
                </p>

                {r.pendingShred && (
                  <div className="mt-3 border-2 border-ink bg-[#ffe1e1] p-2 text-sm">
                    Keys destroyed, receipt not yet published.{" "}
                    <button
                      type="button"
                      className="font-bold underline"
                      onClick={() => {
                        setFocusRecord(r.entityKey);
                        router.push("/app/shred");
                      }}
                    >
                      Retry publishing →
                    </button>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {live && data.some((x) => x.parents.some((p) => p.entityKey === r.entityKey)) && (
                    <ChildrenButton
                      parent={r.entityKey}
                      relations={[...new Set(data.flatMap((x) => x.parents.filter((p) => p.entityKey === r.entityKey).map((p) => p.relation)))]}
                      onResult={setSearch}
                    />
                  )}
                  <Button
                    size="sm"
                    tone="cyan"
                    onClick={() => onSelect(r.entityKey)}
                    disabled={r.status === "shredded" || r.pendingShred}
                  >
                    View
                  </Button>
                  <Button
                    size="sm"
                    tone="pink"
                    disabled={!live || r.pendingShred}
                    onClick={() => {
                      setFocusRecord(r.entityKey);
                      router.push("/app/prove");
                    }}
                  >
                    Prove
                  </Button>
                  <Button size="sm" tone="yellow" disabled={!live} onClick={() => renewOne(r.entityKey)}>
                    Renew
                  </Button>
                  {live && <ReminderButton entityKey={r.entityKey} />}
                  <Button
                    size="sm"
                    tone="lime"
                    disabled={r.status === "shredded"}
                    onClick={() => {
                      setFocusRecord(r.entityKey);
                      router.push("/app/shred");
                    }}
                  >
                    Shred
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RenewBar({ keys, onDone, onClear }: { keys: string[]; onDone: () => void; onClear: () => void }) {
  const [days, setDays] = useState(30);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string; extended: number } | null>(null);

  async function run() {
    setRunning(true);
    setSteps([]);
    setError(null);
    setResult(null);
    try {
      const r = await renewRecords(keys, days * DAY, (s) => setSteps((p) => [...p, s]));
      setResult(r);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="nb-card mb-4 space-y-3 bg-cyan p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          Renew {keys.length} record{keys.length === 1 ? "" : "s"}
        </p>
        <button type="button" className="font-mono text-xs font-bold underline" onClick={onClear} disabled={running}>
          clear selection
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="nb-label m-0">Extend by</span>
        {RENEW_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={running}
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={cx(
              "border-[3px] border-ink px-3 py-1 font-mono text-sm font-bold",
              days === d ? "bg-yellow shadow-brutal-sm" : "bg-white",
            )}
          >
            +{d}d
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="ink" onClick={run} disabled={running}>
          {running ? "Renewing…" : `Renew ${keys.length} · 1 transaction`}
        </Button>
        <span className="text-xs">
          All selected records are extended in a single Arkiv transaction.
        </span>
      </div>
      <StepLog lines={steps} running={running} />
      {error && <ErrorBox title="Renewal failed" error={error} />}
      {result && (
        <div className="nb-border space-y-1 bg-lime p-3 text-sm">
          <p className="font-bold">
            Extended {result.extended} record{result.extended === 1 ? "" : "s"} in 1 transaction.
          </p>
          <HashLine value={result.txHash} />
        </div>
      )}
    </div>
  );
}

function ReminderButton({ entityKey }: { entityKey: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const url = await reminderIcsUrl(entityKey, REMINDER_DAYS_BEFORE);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arkivzk-expiry-${entityKey.slice(0, 10)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <Button size="sm" tone="white" onClick={download} disabled={busy} title={`Calendar reminder ${REMINDER_DAYS_BEFORE} day before expiry`}>
        {busy ? "…" : "📅 Reminder"}
      </Button>
      {error && <span className="mt-1 max-w-[14rem] font-mono text-[0.7rem] text-danger">{error}</span>}
    </span>
  );
}

/** Ticks every second so countdowns (incl. 5-minute demo records) stay live. */
function useNow(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

type SearchResult = { keys: Set<string>; queries: number; tagsTried: number; label: string; note?: string };

/** JOIN on the blind foreign key: one Arkiv query per relation, results shown as a filtered list. */
function ChildrenButton({ parent, relations, onResult }: { parent: string; relations: string[]; onResult: (r: SearchResult | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const keys = new Set<string>();
      let queries = 0;
      for (const rel of relations) {
        const r = await childrenOf(parent, rel);
        r.keys.forEach((k) => keys.add(k));
        queries += r.queries;
      }
      onResult({ keys, queries, tagsTried: relations.length, label: `children of ${parent.slice(0, 10)}… (${relations.join(", ")})`, note: "JOIN on a blind foreign key" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col">
      <Button size="sm" tone="violet" onClick={run} disabled={busy}>
        {busy ? "Joining…" : "Children"}
      </Button>
      {error && <span className="mt-1 max-w-[14rem] font-mono text-[0.7rem] text-danger">{error}</span>}
    </span>
  );
}

type Mode = "exact" | "range";

function SearchBox({
  schemaId,
  fields,
  result,
  onResult,
}: {
  schemaId: string;
  fields: { name: string; numeric?: boolean }[];
  result: SearchResult | null;
  onResult: (r: SearchResult | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("exact");
  const [field, setField] = useState(fields[0]?.name ?? "");
  const [value, setValue] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<{ label: string; count: number; queries: number } | null>(null);
  const numericFields = fields.filter((f) => f.numeric);
  const activeFields = mode === "range" ? numericFields : fields;
  const fieldName = activeFields.some((f) => f.name === field) ? field : activeFields[0]?.name ?? "";
  const numeric = fields.find((f) => f.name === fieldName)?.numeric ?? false;

  function parse(): { where: { eq: FieldValue } | { min: number; max: number }; label: string } | null {
    if (mode === "exact") {
      const v = value.trim();
      if (!v) return null;
      if (numeric) {
        const n = Number(v);
        if (!Number.isFinite(n)) { setError(`${fieldName} must be a number`); return null; }
        return { where: { eq: n }, label: `${fieldName} = ${v}` };
      }
      return { where: { eq: v }, label: `${fieldName} = ${v}` };
    }
    const a = Number(min), b = Number(max);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 255 || a > b) { setError("Range bounds must be integers with 0 ≤ min ≤ max ≤ 255"); return null; }
    return { where: { min: a, max: b }, label: `${fieldName} in [${a}, ${b}]` };
  }

  async function run(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const q = parse();
    if (!q) return;
    setBusy(true);
    setCount(null);
    try {
      if ("eq" in q.where) {
        const r = await searchRecords(schemaId, fieldName, q.where.eq);
        onResult({ keys: new Set(r.keys), queries: r.queries, tagsTried: r.tagsTried, label: q.label });
      } else {
        const r = await searchRange(schemaId, fieldName, q.where.min, q.where.max);
        onResult({ keys: new Set(r.keys), queries: r.queries, tagsTried: r.terms, label: q.label, note: `${r.nodes} tree node${r.nodes === 1 ? "" : "s"} per month` });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runCount() {
    setError(null);
    const q = parse();
    if (!q) return;
    setBusy(true);
    try {
      const r = await countRecords(schemaId, fieldName, q.where);
      setCount({ label: q.label, count: r.count, queries: r.queries });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nb-border mb-4 bg-white p-3">
      <div className="mb-2 flex gap-0" role="group" aria-label="Search mode">
        {(["exact", "range"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={busy || (m === "range" && numericFields.length === 0)}
            onClick={() => { setMode(m); setError(null); setCount(null); }}
            className={cx("border-[3px] border-ink px-3 py-1 font-mono text-xs font-bold", mode === m ? "bg-yellow" : "bg-white hover:bg-paper", m === "range" && "-ml-[3px]")}
          >
            {m === "exact" ? "Exact match" : "Range"}
          </button>
        ))}
      </div>
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="nb-label" htmlFor="search-field">Search field</label>
          <select id="search-field" className="nb-input w-auto" value={fieldName} onChange={(e) => setField(e.target.value)} disabled={busy}>
            {activeFields.map((f) => (
              <option key={f.name}>{f.name}</option>
            ))}
          </select>
        </div>
        {mode === "exact" ? (
          <div className="min-w-[8rem] flex-1">
            <label className="nb-label" htmlFor="search-value">Exact value</label>
            <input id="search-value" className="nb-input" inputMode={numeric ? "numeric" : undefined} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </div>
        ) : (
          <>
            <div className="w-24">
              <label className="nb-label" htmlFor="search-min">Min</label>
              <input id="search-min" className="nb-input" type="number" min={0} max={255} value={min} onChange={(e) => setMin(e.target.value)} disabled={busy} />
            </div>
            <div className="w-24">
              <label className="nb-label" htmlFor="search-max">Max</label>
              <input id="search-max" className="nb-input" type="number" min={0} max={255} value={max} onChange={(e) => setMax(e.target.value)} disabled={busy} />
            </div>
          </>
        )}
        <Button type="submit" tone="cyan" disabled={busy || (mode === "exact" ? !value.trim() : min === "" || max === "")}>
          {busy ? "Working…" : "Search"}
        </Button>
        <Button type="button" tone="white" onClick={runCount} disabled={busy || (mode === "exact" ? !value.trim() : min === "" || max === "")}>
          Count
        </Button>
        {result && (
          <Button type="button" tone="white" onClick={() => onResult(null)} disabled={busy}>
            Clear
          </Button>
        )}
      </form>
      <p className="mt-2 text-xs opacity-70">
        {mode === "exact"
          ? "Blind-index search: only finds records where this field was marked searchable when created."
          : "Range search: only finds records created with this field range-indexed (0–255). Arkiv sees HMAC tags, never the value or your bounds."}{" "}
        Count asks Arkiv to count matching tags: no records are downloaded.
      </p>
      {result && (
        <p className="mt-2 font-mono text-xs font-bold">
          {result.keys.size} match{result.keys.size === 1 ? "" : "es"} · {result.queries} quer
          {result.queries === 1 ? "y" : "ies"}, {result.tagsTried} {result.note?.startsWith("JOIN") ? "relation" : "tag"}{result.tagsTried === 1 ? "" : "s"}
          {result.note ? ` · ${result.note}` : ""}
        </p>
      )}
      {count && (
        <p className="mt-2 border-2 border-ink bg-lime px-2 py-1 font-mono text-xs font-bold" data-testid="count-result">
          COUNT({count.label}) = {count.count} · {count.queries} count quer{count.queries === 1 ? "y" : "ies"}, 0 rows downloaded
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBox title="Search failed" error={error} />
        </div>
      )}
    </div>
  );
}
