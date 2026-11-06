"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { listRecords, proveClaim, type Claim, type ProveResult } from "@/lib/arkivzk-client";
import { errorMessage, shortHex } from "@/lib/format";
import { useAsync, useElapsed } from "@/lib/use-async";
import { Button, Card, ErrorBox, Field, KV, Loading, cx } from "@/components/ui";
import { CopyButton, HashLine } from "@/components/copy-button";
import { StepLog } from "@/components/step-list";
import { useWallet } from "../wallet-context";

type Mode = "range" | "equals";

function randomNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function ProveView() {
  const records = useAsync(listRecords);
  const { focusRecord } = useWallet();
  const live = useMemo(() => (records.data ?? []).filter((r) => r.status === "live"), [records.data]);

  const [pickedKey, setPickedKey] = useState<string>("");
  const [pickedField, setPickedField] = useState<string>("");
  const [mode, setMode] = useState<Mode>("range");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [equals, setEquals] = useState("");
  const [nonce, setNonce] = useState("");

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProveResult | null>(null);
  const elapsed = useElapsed(running);

  // Derived selection: explicit pick > record focused from the Vault tab > first live record.
  const recordKey =
    (pickedKey && live.some((r) => r.entityKey === pickedKey) && pickedKey) ||
    (focusRecord && live.some((r) => r.entityKey === focusRecord) && focusRecord) ||
    live[0]?.entityKey ||
    "";
  const record = live.find((r) => r.entityKey === recordKey);
  const field =
    (record && record.fieldNames.includes(pickedField) && pickedField) || record?.fieldNames[0] || "";

  const minN = min.trim() === "" ? undefined : Number(min);
  const maxN = max.trim() === "" ? undefined : Number(max);
  const rangeValid =
    (minN !== undefined || maxN !== undefined) &&
    (minN === undefined || Number.isFinite(minN)) &&
    (maxN === undefined || Number.isFinite(maxN)) &&
    (minN === undefined || maxN === undefined || minN <= maxN);
  const equalsValid = equals.trim() !== "";
  const canSubmit =
    !!record && !!field && nonce.trim() !== "" && (mode === "range" ? rangeValid : equalsValid) && !running;

  const claimPreview = (() => {
    if (!field) return "";
    if (mode === "equals") return equals.trim() ? `${field} = ${equals.trim()}` : `${field} = ?`;
    if (minN !== undefined && maxN !== undefined) return `${minN} ≤ ${field} ≤ ${maxN}`;
    if (minN !== undefined) return `${field} ≥ ${minN}`;
    if (maxN !== undefined) return `${field} ≤ ${maxN}`;
    return `${field} in [?, ?]`;
  })();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !record) return;
    let claim: Claim;
    if (mode === "range") {
      claim = { field, ...(minN !== undefined && { min: minN }), ...(maxN !== undefined && { max: maxN }) };
    } else {
      const t = equals.trim();
      const asNum = Number(t);
      claim = { field, equals: t !== "" && Number.isFinite(asNum) ? asNum : t };
    }
    setRunning(true);
    setSteps([]);
    setError(null);
    setResult(null);
    try {
      const res = await proveClaim(record.entityKey, claim, nonce.trim(), (s) =>
        setSteps((p) => [...p, s]),
      );
      setResult(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,28rem)_1fr]">
      <Card className="self-start p-0">
        <div className="border-b-[3px] border-ink bg-pink p-5">
          <p className="font-mono text-xs font-bold uppercase">zero-knowledge proof</p>
          <h2 className="text-2xl font-bold">Prove a claim</h2>
          <p className="mt-1 text-sm">
            The verifier learns whether the claim holds, and nothing else about the record.
          </p>
        </div>

        <div className="p-5">
          {records.loading && !records.data && <Loading label="Loading records" />}
          {records.error && (
            <ErrorBox title="Could not load records" error={records.error} onRetry={records.reload} />
          )}
          {records.data && live.length === 0 && (
            <div className="nb-border border-dashed bg-white p-5 text-center">
              <p className="font-bold">No live records to prove.</p>
              <Link href="/app" className="nb-btn mt-3 bg-cyan">
                Create one in the Vault
              </Link>
            </div>
          )}

          {live.length > 0 && (
            <form onSubmit={submit} className="space-y-4">
              <Field label="Record" htmlFor="record">
                <select
                  id="record"
                  className="nb-input"
                  value={recordKey}
                  onChange={(e) => setPickedKey(e.target.value)}
                  disabled={running}
                >
                  {live.map((r) => (
                    <option key={r.entityKey} value={r.entityKey}>
                      {r.schemaId} · {shortHex(r.entityKey, 10, 6)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Field" htmlFor="field">
                <select
                  id="field"
                  className="nb-input"
                  value={field}
                  onChange={(e) => setPickedField(e.target.value)}
                  disabled={running || !record}
                >
                  {record?.fieldNames.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Field>

              <fieldset>
                <legend className="nb-label">Claim</legend>
                <div className="flex">
                  {(["range", "equals"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      disabled={running}
                      aria-pressed={mode === m}
                      className={cx(
                        "-ml-[3px] flex-1 border-[3px] border-ink px-3 py-2 font-bold first:ml-0",
                        mode === m ? "relative z-10 bg-yellow" : "bg-white hover:bg-paper",
                      )}
                    >
                      {m === "range" ? "Range (min / max)" : "Equals"}
                    </button>
                  ))}
                </div>
              </fieldset>

              {mode === "range" ? (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Min (inclusive)" htmlFor="min">
                    <input id="min" className="nb-input" type="number" value={min} onChange={(e) => setMin(e.target.value)} disabled={running} />
                  </Field>
                  <Field label="Max (inclusive)" htmlFor="max">
                    <input id="max" className="nb-input" type="number" value={max} onChange={(e) => setMax(e.target.value)} disabled={running} />
                  </Field>
                  {(min || max) && !rangeValid && (
                    <p className="col-span-2 text-xs font-bold text-danger">Set at least one bound; min must be ≤ max.</p>
                  )}
                </div>
              ) : (
                <Field label="Equals" htmlFor="equals" hint="Numbers are sent as numbers, everything else as text.">
                  <input id="equals" className="nb-input" value={equals} onChange={(e) => setEquals(e.target.value)} disabled={running} />
                </Field>
              )}

              <Field
                label="Verifier nonce"
                htmlFor="nonce"
                hint="Ask the verifier for this value. It binds the proof to their request so it can't be replayed elsewhere."
              >
                <div className="flex gap-2">
                  <input
                    id="nonce"
                    className="nb-input"
                    value={nonce}
                    onChange={(e) => setNonce(e.target.value)}
                    disabled={running}
                    placeholder="0x…"
                  />
                  <Button type="button" tone="white" size="sm" onClick={() => setNonce(randomNonce())} disabled={running}>
                    Random
                  </Button>
                </div>
              </Field>

              {claimPreview && (
                <div className="nb-border bg-paper p-3">
                  <p className="nb-label">Statement</p>
                  <p className="font-mono text-lg font-bold">{claimPreview}</p>
                </div>
              )}

              <Button type="submit" tone="ink" size="lg" className="w-full" disabled={!canSubmit}>
                {running ? `Proving… ${(elapsed / 1000).toFixed(1)} s` : "Generate proof"}
              </Button>
            </form>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        {!running && !result && !error && (
          <Card>
            <h3 className="text-xl font-bold">What happens</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
              <li>Your device decrypts the record and loads the field + commitment salt as private inputs.</li>
              <li>A Noir circuit proves the committed field satisfies the claim (UltraHonk, in the browser).</li>
              <li>The proof is published on Arkiv as a proof entity that points at the record.</li>
              <li>You get a link. Anyone can open it and verify without a wallet or key.</li>
            </ol>
            <p className="mt-3 text-xs">
              Proving takes seconds. In Node on a laptop we measured ≈1–4 s; the real time is shown below.
            </p>
          </Card>
        )}

        {(running || steps.length > 0) && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xl font-bold">Progress</h3>
              {running && <span className="font-mono text-sm">{(elapsed / 1000).toFixed(1)} s</span>}
            </div>
            <StepLog lines={steps} running={running} />
          </div>
        )}

        {error && <ErrorBox title="Proof failed" error={error} />}

        {result && <ProofResult result={result} />}
      </div>
    </div>
  );
}

function ProofResult({ result }: { result: ProveResult }) {
  const path = `/verify/${result.proofEntityKey}`;
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  return (
    <Card tone="lime" className="p-0">
      <div className="border-b-[3px] border-ink p-5">
        <p className="font-mono text-xs font-bold uppercase">proof published</p>
        <p className="mt-1 text-2xl font-bold">{result.statementText}</p>
        <p className="mt-1 font-mono text-sm">generated in {(result.proveMs / 1000).toFixed(2)} s</p>
      </div>
      <div className="bg-white p-5">
        <dl>
          <KV k="Proof entity"><HashLine value={result.proofEntityKey} /></KV>
          <KV k="Tx hash"><HashLine value={result.txHash} /></KV>
        </dl>
        <div className="mt-4 nb-border bg-yellow p-4">
          <p className="nb-label">Share this verify link</p>
          <p className="break-all font-mono text-sm">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={url} label="Copy link" />
            <Link href={path} className="nb-btn bg-ink px-2.5 py-1 text-xs text-paper">
              Open verify page →
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
