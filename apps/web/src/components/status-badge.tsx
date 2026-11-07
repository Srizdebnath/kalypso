import type { RecordStatus } from "@/lib/arkivzk-client";

const BASE = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wider";

/** Live is solid white, shredded is a struck-through outline, expired is dashed. Readable without color. */
export function StatusBadge({ status }: { status: RecordStatus }) {
  if (status === "live")
    return (
      <span className={`${BASE} bg-[#fff] text-black`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-black" /> live
      </span>
    );
  if (status === "shredded")
    return <span className={`${BASE} border border-white/25 text-white/45 line-through decoration-white/45`}>✕ shredded</span>;
  return <span className={`${BASE} border border-dashed border-white/35 text-white/60`}>◌ expired</span>;
}
