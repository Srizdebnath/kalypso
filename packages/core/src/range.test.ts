import { test } from "node:test";
import assert from "node:assert/strict";
import { rangeCover, rangePath, RANGE_MAX } from "./range.js";

test("range cover is exact, disjoint and <= 14 nodes for every [a,b] in 0..255", () => {
  let maxNodes = 0;
  for (let a = 0; a <= RANGE_MAX; a++) {
    for (let b = a; b <= RANGE_MAX; b++) {
      const cover = rangeCover(a, b);
      if (cover === "all") { assert.ok(a === 0 && b === RANGE_MAX); continue; }
      maxNodes = Math.max(maxNodes, cover.length);
      const hit = new Uint8Array(RANGE_MAX + 1);
      for (const n of cover) {
        const w = 1 << (8 - n.level);
        for (let v = n.prefix * w; v < n.prefix * w + w; v++) hit[v]++;
      }
      for (let v = 0; v <= RANGE_MAX; v++) assert.equal(hit[v], v >= a && v <= b ? 1 : 0, `[${a},${b}] value ${v}`);
    }
  }
  assert.equal(maxNodes, 14);
});

test("a value matches exactly one cover node through its path tags", () => {
  for (const [a, b] of [[18, 40], [0, 17], [100, 255], [37, 37]] as const) {
    const cover = rangeCover(a, b) as { level: number; prefix: number }[];
    for (let v = 0; v <= RANGE_MAX; v++) {
      const path = rangePath(v);
      const matches = cover.filter((n) => path[n.level - 1].prefix === n.prefix).length;
      assert.equal(matches, v >= a && v <= b ? 1 : 0);
    }
  }
});

test("rangePath rejects values outside 0..255", () => {
  assert.throws(() => rangePath(256));
  assert.throws(() => rangePath(-1));
  assert.throws(() => rangePath(1.5));
});
