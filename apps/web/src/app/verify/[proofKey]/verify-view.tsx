"use client";

import Link from "next/link";
import { verifyProof, type VerifyResult } from "@/lib/arkivzk-client";
import { useAsync } from "@/lib/use-async";
import { Badge, Card, ErrorBox, KV, Loading } from "@/components/ui";
import { HashLine } from "@/components/copy-button";
import { StatusBadge } from "@/components/status-badge";

export function VerifyView({ proofKey }: { proofKey: string }) {
  const { data, error, loading, reload } = useAsync<VerifyResult>(() => verifyProof(proofKey), proofKey);

  return (
    <div className="space-y-6">
      <Card className="py-3">
        <dl>
          <KV k="Proof entity"><HashLine value={proofKey} /></KV>
        </dl>
      </Card>

      {loading && (
        <Card>
          <Loading label="Fetching proof from Arkiv and verifying" />
        </Card>
      )}
      {error && <ErrorBox title="Could not verify" error={error} onRetry={reload} />}
      {data && !loading && <Verdict r={data} />}
    </div>
  );
}

function Verdict({ r }: { r: VerifyResult }) {
  const shredded = r.recordStatus === "shredded";
  const accepted = r.valid && !shredded;

  const tone = accepted ? "bg-lime" : shredded && r.valid ? "bg-yellow" : "bg-danger";
  const headline = accepted ? "VALID" : shredded && r.valid ? "REVOKED" : "INVALID";

  return (
    <div className="nb-card p-0">
      <div className={`${tone} border-b-[3px] border-ink p-6`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-14 w-14 place-items-center border-[3px] border-ink bg-white text-3xl font-bold">
            {accepted ? "✓" : "✕"}
          </span>
          <div>
            <p className="font-mono text-xs font-bold uppercase">verdict</p>
            <p className="text-4xl font-bold leading-none">{headline}</p>
          </div>
        </div>
        <p className="mt-5 text-sm font-bold uppercase">The statement</p>
        <p className="text-2xl font-bold md:text-3xl">{r.statementText}</p>
      </div>
      <div className="space-y-4 bg-white p-6">
        <ul className="space-y-2 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <Badge tone={r.valid ? "lime" : "danger"}>{r.valid ? "✓ proof verifies" : "✕ proof does not verify"}</Badge>
            {r.reason && <span className="font-mono text-xs">{r.reason}</span>}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="font-bold">Record status:</span> <StatusBadge status={r.recordStatus} />
          </li>
        </ul>
        {r.checks.length > 0 && (
          <div>
            <p className="nb-label">Checks</p>
            <ol className="nb-border divide-y-2 divide-ink">
              {r.checks.map((c, i) => (
                <li key={i} className={`flex items-start gap-3 p-3 ${c.ok ? "bg-white" : "bg-[#eaeaea]"}`}>
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center border-2 border-ink font-mono text-sm font-bold ${
                      c.ok ? "bg-lime" : "bg-danger"
                    }`}
                    aria-label={c.ok ? "passed" : "failed"}
                  >
                    {c.ok ? "✓" : "✕"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold">{c.name}</p>
                    {c.detail && <p className="break-all font-mono text-xs">{c.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {shredded && (
          <div className="nb-border bg-yellow p-4 text-sm">
            <p className="font-bold">This record has been shredded.</p>
            <p className="mt-1">
              The proof was true when it was made, but the owner has since destroyed the data&apos;s
              keys. Treat it as revoked.
            </p>
            {r.receiptKey && (
              <Link href={`/receipt/${r.receiptKey}`} className="nb-btn mt-3 bg-white px-2.5 py-1 text-xs">
                View shred receipt →
              </Link>
            )}
          </div>
        )}
        {r.recordStatus === "expired" && (
          <div className="nb-border bg-violet p-4 text-sm">
            The record&apos;s Arkiv entity has expired. The proof describes data that is no longer live.
          </div>
        )}
        <dl>
          <KV k="Record">
            <HashLine value={r.recordKey} />
          </KV>
          <KV k="VK hash">{r.vkHash}</KV>
        </dl>
        <p className="text-xs">
          You learned only the statement above. The record itself stays encrypted.{" "}
          <Link href="/docs/03-zk" className="font-bold underline">
            How this works
          </Link>
        </p>
      </div>
    </div>
  );
}
