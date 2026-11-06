import type { PublicArkivClient } from "@arkiv-network/sdk";
import { eq, or } from "@arkiv-network/sdk/query";

const CHUNK = 20;

/**
 * Which of these entity keys are live, and their expiry block.
 * Before: one getEntity per key  -> k RPC calls.
 * After:  `$key IN (...)` batches -> ceil(k / 20) queries.
 */
export async function liveKeys(pc: PublicArkivClient, keys: string[]): Promise<Map<string, bigint>> {
  const uniq = [...new Set(keys.map((k) => k.toLowerCase()))];
  const out = new Map<string, bigint>();
  const chunks = Array.from({ length: Math.ceil(uniq.length / CHUNK) }, (_, i) => uniq.slice(i * CHUNK, (i + 1) * CHUNK));
  await Promise.all(chunks.map(async (c) => {
    const res = await pc.select({ $key: true, $expiresAt: true })
      .where(c.length === 1 ? eq("$key", c[0] as any) : or(...c.map((k) => eq("$key", k as any))))
      .limit(100).fetch();
    for (const e of res.entities) out.set(String(e.$key).toLowerCase(), e.$expiresAt as bigint);
  }));
  return out;
}
