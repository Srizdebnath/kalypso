import { randomBytes } from "./bytes.js";

// Shamir secret sharing over GF(2^8) (AES polynomial 0x11b), byte-wise.
// Share format: [x (1 byte, 1..255)] || y-bytes (same length as secret).

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by generator 3
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a: number, b: number) => {
  if (b === 0) throw new Error("div by zero");
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
};

export function split(secret: Uint8Array, n: number, t: number): Uint8Array[] {
  if (t < 2 || t > n || n > 255) throw new Error("need 2 <= t <= n <= 255");
  const shares = Array.from({ length: n }, (_, i) => {
    const s = new Uint8Array(secret.length + 1);
    s[0] = i + 1;
    return s;
  });
  const coeffs = new Uint8Array(t);
  for (let byte = 0; byte < secret.length; byte++) {
    coeffs[0] = secret[byte];
    coeffs.set(randomBytes(t - 1), 1);
    for (const share of shares) {
      const x = share[0];
      let y = 0;
      for (let k = t - 1; k >= 0; k--) y = mul(y, x) ^ coeffs[k]; // Horner
      share[byte + 1] = y;
    }
  }
  coeffs.fill(0);
  return shares;
}

export function combine(shares: Uint8Array[]): Uint8Array {
  if (shares.length < 2) throw new Error("need at least 2 shares");
  const len = shares[0].length;
  const xs = shares.map((s) => s[0]);
  if (new Set(xs).size !== xs.length || xs.includes(0)) throw new Error("bad share ids");
  if (shares.some((s) => s.length !== len)) throw new Error("share length mismatch");
  const out = new Uint8Array(len - 1);
  for (let byte = 1; byte < len; byte++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      // Lagrange basis at x=0
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = mul(num, xs[j]);
        den = mul(den, xs[i] ^ xs[j]);
      }
      acc ^= mul(shares[i][byte], div(num, den));
    }
    out[byte - 1] = acc;
  }
  return out;
}
