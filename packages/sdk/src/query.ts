import type { PublicArkivClient, Schema } from "@arkiv-network/sdk";
import { and, or, eq, gt, gte, lt, lte, between, startsWith, asc } from "@arkiv-network/sdk/query";
import { key, addr, u64 } from "@arkiv-network/sdk";
import { APP, ZkProof, ZkRecord } from "@arkivzk/core";
import { audienceFor } from "./statement.js";

/**
 * A small SQL-ish planner over Arkiv.
 *  - pushes predicates on indexed columns down to Arkiv
 *  - runs everything else client-side (non-indexed columns, or encrypted fields after decryption)
 *  - narrow projections by default (never pulls large bytes columns unless asked)
 *  - keyset pagination on $key (stable, no offset drift)
 *  - IN-batching: many eq lookups become a few OR queries (no N+1)
 *  - explain() shows the plan and its cost before you run it
 */

type Op = { eq?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; between?: [unknown, unknown]; startsWith?: string; in?: unknown[] };
export type Where = Record<string, unknown | Op>;

export type QuerySpec<S extends Schema = Schema> = {
  from: S;
  where?: Where;
  ownedBy?: `0x${string}`;
  select?: string[];
  /** client-side predicate on fetched rows (or decrypted rows, see ArkivZK) */
  filter?: (row: any) => boolean;
  limit?: number;
  pageSize?: number;
};

export type Plan = {
  schema: string;
  pushdown: string[];
  clientSide: string[];
  projection: string[];
  pagination: "keyset($key)";
  arkivQueries: string;
  warnings: string[];
};

const QUOTA_PER_QUERY = 10;
const SYSTEM = new Set(["$key", "$owner", "$creator", "$expiresAt"]);
const IN_CHUNK = 20;

const isOp = (v: unknown): v is Op =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array) &&
  Object.keys(v).every((k) => ["eq", "gt", "gte", "lt", "lte", "between", "startsWith", "in"].includes(k));

function columnsOf(s: Schema): Record<string, { isIndexed: boolean; type: string }> {
  return (s as any).columns;
}
const schemaName = (s: Schema) => String((s as any).name?.value ?? (s as any).name ?? "untagged");

/** System attributes have fixed types in SDK 1.0: wrap raw values so `$key = "0x…"` is not sent as a str. */
function sysValue(field: string, x: unknown): unknown {
  if (x === undefined || x === null || typeof x === "object") return x;
  if (field === "$key") return key(String(x) as `0x${string}`);
  if (field === "$owner" || field === "$creator") return addr(String(x) as `0x${string}`);
  if (field === "$expiresAt") return u64(BigInt(x as any));
  return x;
}

function toExpressions(field: string, raw: unknown) {
  const w = (x: unknown) => sysValue(field, x);
  const r: Op = isOp(raw) ? raw : { eq: raw };
  const op: Op = {
    ...r,
    ...(r.eq !== undefined ? { eq: w(r.eq) } : {}), ...(r.gt !== undefined ? { gt: w(r.gt) } : {}),
    ...(r.gte !== undefined ? { gte: w(r.gte) } : {}), ...(r.lt !== undefined ? { lt: w(r.lt) } : {}),
    ...(r.lte !== undefined ? { lte: w(r.lte) } : {}),
    ...(r.between ? { between: [w(r.between[0]), w(r.between[1])] as any } : {}),
    ...(r.in ? { in: r.in.map(w) } : {}),
  };
  const out: any[] = [];
  if (op.eq !== undefined) out.push(eq(field, op.eq as any));
  if (op.gt !== undefined) out.push(gt(field, op.gt as any));
  if (op.gte !== undefined) out.push(gte(field, op.gte as any));
  if (op.lt !== undefined) out.push(lt(field, op.lt as any));
  if (op.lte !== undefined) out.push(lte(field, op.lte as any));
  if (op.between) out.push(between(field, op.between[0] as any, op.between[1] as any));
  if (op.startsWith !== undefined) out.push(startsWith(field, op.startsWith));
  if (op.in) out.push(or(...op.in.map((x) => eq(field, x as any))));
  return out;
}

function matches(row: any, field: string, v: unknown) {
  const raw = row[field]?.value ?? row[field];
  const op: Op = isOp(v) ? v : { eq: v };
  if (op.eq !== undefined && raw !== op.eq) return false;
  if (op.gt !== undefined && !(raw > (op.gt as any))) return false;
  if (op.gte !== undefined && !(raw >= (op.gte as any))) return false;
  if (op.lt !== undefined && !(raw < (op.lt as any))) return false;
  if (op.lte !== undefined && !(raw <= (op.lte as any))) return false;
  if (op.between && !(raw >= (op.between[0] as any) && raw <= (op.between[1] as any))) return false;
  if (op.startsWith !== undefined && !String(raw).startsWith(op.startsWith)) return false;
  if (op.in && !op.in.includes(raw)) return false;
  return true;
}

export class QueryPlanner {
  constructor(private pc: PublicArkivClient) {}

  plan(spec: QuerySpec): Plan {
    const cols = columnsOf(spec.from);
    const pushdown: string[] = [];
    const clientSide: string[] = [];
    const warnings: string[] = [];
    for (const [f, v] of Object.entries(spec.where ?? {})) {
      const indexed = SYSTEM.has(f) || cols[f]?.isIndexed;
      if (!SYSTEM.has(f) && !cols[f]) throw new Error(`unknown column ${f} (columns: ${Object.keys(cols).join(", ")})`);
      (indexed ? pushdown : clientSide).push(`${f} ${JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))}`);
      if (!indexed) warnings.push(`"${f}" is not indexed: filtered client-side after fetching`);
    }
    if (spec.ownedBy) pushdown.push(`$owner = ${spec.ownedBy}`);
    if (spec.filter) clientSide.push("custom filter()");
    if (pushdown.length === 0) warnings.push("no indexed predicate: full scan of this schema");
    const projection = spec.select ?? Object.entries(cols).filter(([, c]) => c.type !== "bytes").map(([k]) => k);
    const heavy = (spec.select ?? []).filter((c) => cols[c]?.type === "bytes");
    if (heavy.length) warnings.push(`selects bytes column(s) ${heavy.join(", ")}: large payloads per row`);
    const inSizes = Object.values(spec.where ?? {}).filter(isOp).map((o) => o.in?.length ?? 0);
    const chunks = Math.max(1, ...inSizes.map((n) => Math.ceil(n / IN_CHUNK)));
    const pageSize = Math.min(spec.pageSize ?? 100, 100);
    const pages = spec.limit ? Math.ceil(spec.limit / pageSize) : "1..n";
    return {
      schema: schemaName(spec.from), pushdown, clientSide, projection: ["$key", ...projection], pagination: "keyset($key)",
      arkivQueries: `${chunks} x ${pages} page(s) of ${pageSize}, ${QUOTA_PER_QUERY} quota units each`,
      warnings,
    };
  }

  explain(spec: QuerySpec): string {
    const p = this.plan(spec);
    return [
      `QUERY PLAN for ${p.schema}`,
      `  Arkiv (indexed, server-side): ${p.pushdown.join(" AND ") || "(none)"}`,
      `  Client-side:                  ${p.clientSide.join(" AND ") || "(none)"}`,
      `  Projection:                   ${p.projection.join(", ")}`,
      `  Pagination:                   ${p.pagination}`,
      `  Cost:                         ${p.arkivQueries}`,
      ...p.warnings.map((w) => `  ! ${w}`),
    ].join("\n");
  }

  async run<T = any>(spec: QuerySpec): Promise<{ rows: T[]; queries: number; plan: Plan }> {
    const plan = this.plan(spec);
    const cols = columnsOf(spec.from);
    const pushEntries = Object.entries(spec.where ?? {}).filter(([f]) => SYSTEM.has(f) || cols[f]?.isIndexed);
    const clientEntries = Object.entries(spec.where ?? {}).filter(([f]) => !(SYSTEM.has(f) || cols[f]?.isIndexed));

    // split big IN lists into chunks -> several OR queries
    const inEntry = pushEntries.find(([, v]) => isOp(v) && v.in && v.in.length > IN_CHUNK);
    const variants: Where[] = inEntry
      ? Array.from({ length: Math.ceil((inEntry[1] as Op).in!.length / IN_CHUNK) }, (_, i) => ({
          ...Object.fromEntries(pushEntries),
          [inEntry[0]]: { in: (inEntry[1] as Op).in!.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK) },
        }))
      : [Object.fromEntries(pushEntries)];

    const selection = Object.fromEntries(plan.projection.map((c) => [c, true]));
    const pageSize = Math.min(spec.pageSize ?? 100, 100);
    const rows: any[] = [];
    let queries = 0;
    for (const w of variants) {
      let cursor: string | undefined;
      for (;;) {
        const exprs = Object.entries(w).flatMap(([f, v]) => toExpressions(f, v));
        if (cursor) exprs.push(gt("$key", key(cursor as `0x${string}`) as any));
        let q: any = this.pc.select(selection as any).from(spec.from);
        if (exprs.length) q = q.where(and(...exprs));
        if (spec.ownedBy) q = q.ownedBy(spec.ownedBy);
        const page = await q.orderBy(asc("$key")).limit(pageSize).fetch();
        queries++;
        for (const r of page.entities) {
          if (clientEntries.every(([f, v]) => matches(r, f, v)) && (!spec.filter || spec.filter(r))) rows.push(r);
        }
        if (spec.limit && rows.length >= spec.limit) return { rows: rows.slice(0, spec.limit), queries, plan };
        if (page.entities.length + (page.skipped ?? 0) < pageSize || page.entities.length === 0) break;
        cursor = page.entities[page.entities.length - 1].$key;
      }
    }
    return { rows, queries, plan };
  }

  // ---- ready-made relational helpers ----

  /** hasMany: proofs for many records in ceil(n/20) queries instead of n. */
  proofsFor(recordKeys: string[]) {
    return this.run({ from: ZkProof, where: { app: APP, recordKey: { in: recordKeys.map((k) => k.toLowerCase()) } }, select: ["recordKey", "claim", "circuitId", "vkHash", "$expiresAt"] });
  }

  /** ZK query: every proof answering a verifier's challenge, e.g. "who proved age>=18 for my nonce". */
  proofsAddressedTo(verifierNonce: string, claim?: string) {
    return this.run({ from: ZkProof, where: { app: APP, audience: audienceFor(verifierNonce), ...(claim ? { claim } : {}) }, select: ["recordKey", "claim", "$owner", "$expiresAt"] });
  }

  /** My records, metadata only (ciphertext not downloaded). */
  recordsOf(owner: `0x${string}`, schemaId?: string) {
    return this.run({ from: ZkRecord, where: { app: APP, ...(schemaId ? { schemaId } : {}) }, ownedBy: owner, select: ["schemaId", "epoch", "commitment", "$expiresAt"] });
  }
}
