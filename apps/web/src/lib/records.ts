import type { LocalRecord } from "./arkivzk-client";
import { formatDuration } from "./format";

export function expiryLabel(r: LocalRecord, now: number): string | null {
  if (r.status !== "live") return null;
  if (r.expiresAtMs == null) return `expires at block ${r.expiresAtBlock}`;
  const left = r.expiresAtMs - now;
  return left > 0 ? `expires in ${formatDuration(left)}` : "expiring now";
}

/** True when the record expires within `ms` from `now`. */
export function expiresWithin(r: LocalRecord, now: number, ms: number): boolean {
  return r.status === "live" && r.expiresAtMs != null && r.expiresAtMs - now <= ms;
}
