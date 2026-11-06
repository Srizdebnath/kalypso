"use client";

import { useState } from "react";
import { explainQuery, runQuery, type QueryPreset } from "@/lib/arkivzk-client";
import { errorMessage } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { Badge, Button, Card, ErrorBox, Field, Loading, cx } from "@/components/ui";

type Kind = QueryPreset["kind"];

const PRESETS: { kind: Kind; label: string; desc: string }[] = [
  { kind: "myRecords", label: "My records", desc: "Record entities this vault knows about." },
  { kind: "proofsForMyRecords", label: "Proofs for my records", desc: "Proof entities that point at your records." },
  { kind: "addressedTo", label: "Proofs addressed to a nonce", desc: "What a verifier sees: proofs made for its nonce." },
];

type RunResult = Awaited<ReturnType<typeof runQuery>>;

export function QueryView() {
  const [kind, setKind] = useState<Kind>("myRecords");
  const [nonce, setNonce] = useState("");
  const [claim, setClaim] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const preset: QueryPreset | null =
    kind === "addressedTo"
      ? nonce.trim()
        ? { kind, nonce: nonce.trim(), ...(claim.trim() && { claim: claim.trim() }) }
        : null
      : { kind };
  const presetKey = preset ? JSON.stringify(preset) : "";

  const plan = useAsync<string | null>(
    () => (preset ? explainQuery(preset) : Promise.resolve(null)),
    presetKey,
  );

  async function run() {
    if (!preset) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runQuery(preset));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  const columns = result ? Array.from(new Set(result.rows.flatMap((r) => Object.keys(r)))) : [];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_1fr]">
      <Card className="self-start p-0">
        <div className="border-b-[3px] border-ink bg-violet p-5">
          <p className="font-mono text-xs font-bold uppercase">query explorer</p>
          <h2 className="text-2xl font-bold">What can Arkiv see?</h2>
          <p className="mt-1 text-sm">
            Arkiv only filters on public, indexed attributes. Pick a preset to see the plan and the
            queries it really runs.
          </p>
        </div>
        <div className="space-y-4 p-5">
          <fieldset className="space-y-2">
            <legend className="nb-label">Preset</legend>
            {PRESETS.map((p) => (
              <label
                key={p.kind}
                className={cx(
                  "flex cursor-pointer items-start gap-3 border-[3px] border-ink p-3",
                  kind === p.kind ? "bg-yellow shadow-brutal-sm" : "bg-white hover:bg-paper",
                )}
              >
                <input
                  type="radio"
                  name="preset"
                  className="mt-1 h-4 w-4 accent-black"
                  checked={kind === p.kind}
                  onChange={() => {
                    setKind(p.kind);
                    setResult(null);
                    setError(null);
                  }}
                />
                <span>
                  <span className="block font-bold">{p.label}</span>
                  <span className="block text-xs">{p.desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {kind === "addressedTo" && (
            <>
              <Field label="Verifier nonce" htmlFor="q-nonce">
                <input id="q-nonce" className="nb-input" value={nonce} onChange={(e) => setNonce(e.target.value)} placeholder="0x…" />
              </Field>
              <Field label="Claim (optional)" htmlFor="q-claim" hint="Narrow to one claim, e.g. age>=18">
                <input id="q-claim" className="nb-input" value={claim} onChange={(e) => setClaim(e.target.value)} />
              </Field>
            </>
          )}
          <Button tone="ink" size="lg" className="w-full" onClick={run} disabled={!preset || running}>
            {running ? "Running…" : "Run query"}
          </Button>
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <section>
          <h3 className="mb-2 text-xl font-bold">EXPLAIN</h3>
          {!preset && <p className="text-sm">Enter a verifier nonce to see the plan.</p>}
          {preset && plan.loading && <Loading label="Planning" />}
          {preset && plan.error && <ErrorBox title="Could not explain query" error={plan.error} onRetry={plan.reload} />}
          {preset && !plan.loading && plan.data && (
            <pre className="nb-card overflow-x-auto whitespace-pre-wrap bg-ink p-4 font-mono text-xs text-lime">
              {plan.data}
            </pre>
          )}
        </section>

        {error && <ErrorBox title="Query failed" error={error} />}

        {result && (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xl font-bold">Results ({result.rows.length})</h3>
              <Badge tone="yellow">
                queries used: {result.queries}
              </Badge>
            </div>
            {result.rows.length === 0 ? (
              <div className="nb-border border-dashed bg-white p-5 text-center font-bold">No rows.</div>
            ) : (
              <div className="overflow-x-auto pb-3 pr-3">
                <table className="nb-card w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-lime text-left">
                      {columns.map((c) => (
                        <th key={c} className="border-2 border-ink p-2">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="bg-white even:bg-paper">
                        {columns.map((c) => (
                          <td key={c} className="max-w-xs break-all border-2 border-ink p-2 font-mono text-xs">
                            {row[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.plan && result.plan !== plan.data && (
              <details className="nb-border mt-4 bg-white p-3">
                <summary className="cursor-pointer font-mono text-xs font-bold uppercase">Executed plan</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">{result.plan}</pre>
              </details>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
