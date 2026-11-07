"use client";

import { StatusBadge } from "@/components/status-badge";
import { Fragment, useState } from "react";
import { listArchive, tryDecryptArchived, type ArchiveItem, type DecryptAttempt } from "@/lib/arkivzk-client";
import { errorMessage, formatBytes, formatDate, shortHex } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { Badge, Button, ErrorBox, Loading, Spinner } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

type AttemptState = { running: boolean; result?: DecryptAttempt; error?: string };

export function ArchiveView() {
  const { data, error, loading, reload } = useAsync<ArchiveItem[]>(listArchive);
  const [attempts, setAttempts] = useState<Record<string, AttemptState>>({});
  const [open, setOpen] = useState<string | null>(null);

  async function attempt(txHash: string) {
    setOpen(txHash);
    setAttempts((a) => ({ ...a, [txHash]: { running: true } }));
    try {
      const result = await tryDecryptArchived(txHash);
      setAttempts((a) => ({ ...a, [txHash]: { running: false, result } }));
    } catch (e) {
      setAttempts((a) => ({ ...a, [txHash]: { running: false, error: errorMessage(e) } }));
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Captured calldata</h2>
        <Button tone="white" size="sm" onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && !data && <Loading label="Loading archive snapshots" />}
      {error && <ErrorBox title="Could not load the archive" error={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <div className="nb-border border-dashed bg-[#fff] p-6 text-center">
          <p className="font-bold">The archive is empty.</p>
          <p className="text-sm">Snapshots appear here once Kalypso transactions land on Arkiv.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto pb-3 pr-3">
          <table className="nb-card w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-ink text-left text-paper">
                <th className="p-3">Tx hash</th>
                <th className="p-3">Block</th>
                <th className="p-3">Captured</th>
                <th className="p-3">Size</th>
                <th className="p-3">Entities</th>
                <th className="p-3">Record</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((it) => {
                const st = attempts[it.txHash];
                const isOpen = open === it.txHash && st;
                return (
                  <Fragment key={it.txHash}>
                    <tr className="border-t-[3px] border-ink bg-[#fff] align-top">
                      <td className="p-3 font-mono">
                        <span className="flex items-center gap-2">
                          {shortHex(it.txHash, 10, 6)} <CopyButton value={it.txHash} />
                        </span>
                      </td>
                      <td className="p-3 font-mono">{it.blockNumber}</td>
                      <td className="p-3">{formatDate(it.capturedAt)}</td>
                      <td className="p-3 font-mono">{formatBytes(it.bytes)}</td>
                      <td className="p-3 font-mono text-xs">
                        {it.entityKeys.map((k) => (
                          <div key={k} title={k}>
                            {shortHex(k, 10, 6)}
                          </div>
                        ))}
                      </td>
                      <td className="p-3">
                        {it.recordShredded ? <StatusBadge status="shredded" /> : <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff] px-2.5 py-0.5 text-[0.68rem] font-semibold tracking-wider text-black uppercase"><span className="h-1.5 w-1.5 rounded-full bg-black" /> keys exist</span>}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          tone="pink"
                          disabled={st?.running}
                          onClick={() => attempt(it.txHash)}
                        >
                          {st?.running ? "Trying…" : "Try to decrypt"}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[#fff]">
                        <td colSpan={7} className="p-3 pt-0">
                          <AttemptPanel state={st} onClose={() => setOpen(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AttemptPanel({ state, onClose }: { state: AttemptState; onClose: () => void }) {
  return (
    <div className="border-[3px] border-ink">
      <div className="flex items-center justify-between border-b-[3px] border-ink bg-paper px-3 py-2">
        <span className="font-mono text-xs font-bold uppercase">decrypt attempt</span>
        <div className="flex items-center gap-3">
          {state.result &&
            (state.result.success ? (
              <Badge tone="danger">decrypted</Badge>
            ) : (
              <Badge tone="lime">failed: no key</Badge>
            ))}
          <button type="button" onClick={onClose} className="font-mono text-xs font-bold underline">
            close
          </button>
        </div>
      </div>
      {state.running && (
        <div className="flex items-center gap-2 bg-ink p-3 font-mono text-xs text-paper">
          <Spinner className="h-3 w-3 border-2 border-paper border-t-transparent" /> running…
        </div>
      )}
      {state.error && (
        <div className="p-3">
          <ErrorBox title="Attempt could not run" error={state.error} />
        </div>
      )}
      {state.result && (
        <>
          <pre className="max-h-80 overflow-auto bg-ink p-3 font-mono text-xs leading-relaxed text-lime">
            {state.result.log.map((l, i) => (
              <div key={i}>
                <span className="text-paper/50">$ </span>
                {l}
              </div>
            ))}
          </pre>
          <p
            className={`border-t-[3px] border-ink p-3 text-sm font-bold ${
              state.result.success ? "bg-yellow" : "bg-lime"
            }`}
          >
            {state.result.success
              ? "Decryption succeeded: the record's keys still existed when this ran. Shred it, then try again."
              : "Decryption failed. The archive has the ciphertext but no key."}
          </p>
        </>
      )}
    </div>
  );
}
