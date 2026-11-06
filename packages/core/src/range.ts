/**
 * Range index over an 8-bit domain [0, 255] as a binary interval tree.
 * Level l (1..8) splits the domain into 2^l buckets of width 2^(8-l); a value's bucket at level l is v >> (8-l).
 * Write: one tag per level (8 tags). Query [lo, hi]: the canonical cover, at most 2 nodes per level,
 * and at most 14 nodes in total (the root, level 0, is "every record" and needs no tag).
 */
export const RANGE_BITS = 8;
export const RANGE_MAX = (1 << RANGE_BITS) - 1;

export type RangeNode = { level: number; prefix: number };

export function rangePath(v: number): RangeNode[] {
  if (!Number.isInteger(v) || v < 0 || v > RANGE_MAX) throw new Error(`range-indexed value must be an integer 0..${RANGE_MAX}`);
  return Array.from({ length: RANGE_BITS }, (_, i) => ({ level: i + 1, prefix: v >> (RANGE_BITS - (i + 1)) }));
}

/** Minimal set of tree nodes whose buckets exactly cover [lo, hi]. O(bits) nodes, O(bits) time. */
export function rangeCover(lo: number, hi: number): RangeNode[] | "all" {
  lo = Math.max(0, Math.ceil(lo));
  hi = Math.min(RANGE_MAX, Math.floor(hi));
  if (lo > hi) return [];
  if (lo === 0 && hi === RANGE_MAX) return "all";
  const out: RangeNode[] = [];
  const walk = (level: number, prefix: number) => {
    const width = 1 << (RANGE_BITS - level);
    const a = prefix * width, b = a + width - 1;
    if (b < lo || a > hi) return;
    if (lo <= a && b <= hi) { out.push({ level, prefix }); return; }
    walk(level + 1, prefix * 2);
    walk(level + 1, prefix * 2 + 1);
  };
  walk(0, 0);
  return out;
}
