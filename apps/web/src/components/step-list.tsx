import type { ShredStep } from "@/lib/arkivzk-client";
import { Spinner, cx } from "./ui";

/** Renders structured steps (shred) or a plain log of step strings (put / prove). */
export function StepList({ steps }: { steps: ShredStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li
          key={s.id}
          className={cx(
            "flex items-start gap-3 border-[3px] border-ink p-3",
            s.status === "done" && "bg-lime",
            s.status === "running" && "bg-yellow",
            s.status === "error" && "bg-danger",
            s.status === "pending" && "bg-white opacity-60",
          )}
        >
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center border-2 border-ink bg-white font-mono text-sm font-bold">
            {s.status === "done" ? "✓" : s.status === "error" ? "✕" : s.status === "running" ? <Spinner className="h-3 w-3 border-2" /> : "·"}
          </span>
          <div className="min-w-0">
            <p className="font-bold">{s.label}</p>
            {s.detail && <p className="break-all font-mono text-xs">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function StepLog({ lines, running }: { lines: string[]; running: boolean }) {
  if (lines.length === 0 && !running) return null;
  return (
    <ol className="space-y-1 border-[3px] border-ink bg-ink p-3 font-mono text-xs text-lime">
      {lines.map((l, i) => {
        const last = i === lines.length - 1;
        return (
          <li key={i} className="flex gap-2">
            <span className="text-paper/60">{last && running ? "▸" : "✓"}</span>
            <span className="break-all">{l}</span>
          </li>
        );
      })}
      {running && lines.length === 0 && (
        <li className="flex items-center gap-2 text-paper">
          <Spinner className="h-3 w-3 border-2 border-paper border-t-transparent" /> starting…
        </li>
      )}
    </ol>
  );
}
