import type { Relayer, Hex } from "./arkivzk.js";

/** Message an ephemeral signer signs to prove it holds its key when asking the relayer for gas. */
export const relayerMessage = (address: string, minBalanceWei: bigint, ts: number) =>
  `arkivzk-relayer|v1|${address.toLowerCase()}|${minBalanceWei}|${ts}`;

/** Browser/client side of the gas relayer (see apps/web/src/app/api/relayer/route.ts). */
export function httpRelayer(url = "/api/relayer"): Relayer {
  return {
    async fund(address: Hex, minBalanceWei: bigint, sign: (m: string) => Promise<Hex>) {
      const ts = Date.now();
      const signature = await sign(relayerMessage(address, minBalanceWei, ts));
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, minBalanceWei: minBalanceWei.toString(), ts, signature }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`relayer: ${j.error ?? r.status}`);
    },
  };
}
