import { ExpirationTime, MAX_LIFETIME } from "@arkiv-network/sdk";
import { guardedBatch } from "@arkivzk/core";
import type { VaultRecord } from "@arkivzk/vault";
import type { ArkivZK } from "./arkivzk.js";
import { liveKeys } from "./live.js";

type Hex = `0x${string}`;
const BLOCK_SECONDS = 2;
export const MAX_LEASE_SECONDS = Number(MAX_LIFETIME) * BLOCK_SECONDS; // ~182.5 days

/**
 * Lease manager: Arkiv entities live at most ~182 days per lease. Data + keys must be renewed TOGETHER:
 * if Arkiv data outlives its keys it's lost, if keys outlive data the user expected erasure that didn't happen.
 * Renewal order: guardians first (keys never die before data), then one atomic Arkiv batch that extends
 * the record and all its proofs (children never outlive the parent).
 */
export class LeaseManager {
  constructor(private zk: ArkivZK) {}

  /** Records whose lease ends within `withinMs` (for reminders). */
  async expiringSoon(withinMs = 7 * 24 * 3600 * 1000): Promise<VaultRecord[]> {
    const now = Date.now();
    return (await this.zk.list()).filter((r) => r.status === "live" && r.expiresAtMs - now <= withinMs);
  }

  /** Extend records by `seconds` from their current expiry (capped at Arkiv's max lifetime from now). */
  async renew(entityKeys: string[], seconds: number, step: (s: string) => void = () => {}) {
    if (seconds <= 0) throw new Error("seconds must be positive");
    const recs: VaultRecord[] = [];
    for (const k of entityKeys) {
      const r = await this.zk.vault.getRecord(k);
      if (!r || r.status !== "live") throw new Error(`${k} is not a live record`);
      recs.push(r);
    }
    const now = await this.zk.publicClient.getBlockNumber();
    const maxBlock = now + MAX_LIFETIME;
    const plan = recs.map((r) => {
      let target = BigInt(r.expiresAtBlock) + BigInt(Math.ceil(seconds / BLOCK_SECONDS));
      if (target > maxBlock) target = maxBlock;
      return { r, target, ms: Date.now() + Number(target - now) * BLOCK_SECONDS * 1000 };
    });

    step("Extending key leases on guardians…");
    // one batched call per guardian, both guardians in parallel: O(1) round trips for k records
    const items = plan.map((p) => ({ recordId: p.r.recordId, expiresAt: p.ms + 60_000 }));
    await Promise.all(this.zk.cfg.guardians.map((g) => g.extend(this.zk.vault, items)));

    step("Extending record + proofs on Arkiv in one transaction (confirm in wallet)…");
    const live = await liveKeys(this.zk.publicClient, plan.flatMap((p) => [p.r.entityKey, ...p.r.proofKeys]));
    const extensions = plan.flatMap((p) =>
      [p.r.entityKey, ...p.r.proofKeys].filter((k) => live.has(k.toLowerCase()))
        .map((k) => ({ entityKey: k as Hex, expiration: ExpirationTime.atBlock(p.target) })));
    const res = await guardedBatch(this.zk.cfg.write, { extensions });
    const after = await liveKeys(this.zk.publicClient, plan.map((p) => p.r.entityKey));
    const blockNow = await this.zk.publicClient.getBlockNumber();
    for (const p of plan) {
      const exp = after.get(p.r.entityKey.toLowerCase()) ?? p.target;
      await this.zk.vault.saveRecord({
        ...p.r, expiresAtBlock: exp.toString(),
        expiresAtMs: Date.now() + Number(exp - blockNow) * BLOCK_SECONDS * 1000,
      });
    }
    return { txHash: res.txHash as Hex, extended: extensions.length };
  }
}

/** iCalendar reminder N days before a record's lease ends. */
export function reminderIcs(r: Pick<VaultRecord, "entityKey" | "schemaId" | "expiresAtMs">, daysBefore = 3, appUrl = "") {
  const at = new Date(r.expiresAtMs - daysBefore * 86400_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(at.getTime() + 30 * 60_000);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//arkivzk//lease//EN", "BEGIN:VEVENT",
    `UID:${r.entityKey}-${daysBefore}@arkivzk`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(at)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:arkivzk: ${r.schemaId} record expires in ${daysBefore} days`,
    `DESCRIPTION:Renew it or let it be permanently erased (keys auto-destroyed). ${appUrl}`,
    "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", "DESCRIPTION:arkivzk lease reminder", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
