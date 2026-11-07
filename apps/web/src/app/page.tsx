import Link from "next/link";
import { Reveal } from "@/components/motion";
import { DEMO_PROOF } from "@/lib/live";

const WORD = "KALYPSO".split("");


const PILLARS = [
  {
    n: "01",
    title: "Encrypt",
    glow: "#b6b6b6",
    icon: "◈",
    lead: "Plaintext never leaves your device.",
    points: [
      "AES-256-GCM in the browser, padded to size buckets",
      "Fresh key per record, split 2-of-3: device + two guardians",
      "Shares travel wrapped in hybrid post-quantum KEM",
      "Files go to Swarm under the same key scheme",
    ],
  },
  {
    n: "02",
    title: "Prove",
    glow: "#a2a2a2",
    icon: "◎",
    lead: "Use your data without showing it.",
    points: [
      "Salted Poseidon2 commitment published on Arkiv",
      "Noir circuits prove ranges and equality",
      "Anyone verifies from Arkiv, no wallet, no key",
      "The verifier learns the claim, nothing else",
    ],
  },
  {
    n: "03",
    title: "Shred",
    glow: "#cbcbcb",
    icon: "✕",
    lead: "Delete the key, not the data.",
    points: [
      "Device and both guardians destroy their shares",
      "Each guardian signs a destruction attestation",
      "One tx deletes entities and writes a public receipt",
      "Old copies remain; nothing can open them",
    ],
  },
  {
    n: "04",
    title: "Query",
    glow: "#9d9d9d",
    icon: "⌕",
    lead: "A database on ciphertext.",
    points: [
      "Exact, range and COUNT on encrypted fields",
      "Blind foreign keys: 1:N, M:N, JOIN, cascade",
      "Atomic multi-record inserts",
      "Planner with explain(), IN-batching, keyset paging",
    ],
  },
];

const FLOW = [
  { t: "Put", d: "Encrypt on device, commit, split the key, write ciphertext to Arkiv." },
  { t: "Prove", d: "Generate a ZK proof over the commitment and publish it." },
  { t: "Verify", d: "Anyone checks it from Arkiv in the browser. No keys." },
  { t: "Shred", d: "All shares destroyed and signed. Receipt goes on-chain." },
  { t: "Break it", d: "An archive node replays old calldata. Decryption fails." },
];


const QUERY_GAINS = [
  ["Range on an encrypted field", "Download + decrypt all · 3,034 ms", "1 query · 497 ms"],
  ["COUNT on an encrypted field", "Decrypt every record", "1 count query · 0 rows"],
  ["Children of 5 parents (JOIN)", "5 queries · 1,826 ms", "1 query · 389 ms"],
  ["Insert patient + doctor + visit + lab", "4 txs, not atomic", "1 atomic tx"],
  ["Delete a parent and its children", "k+1 txs, found by scan", "1 tx, keys destroyed"],
  ["Proofs of 45 records", "45 queries", "3 queries"],
];



function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[0.7rem] tracking-[0.2em] text-[#b9b9b9] uppercase">
      <span className="h-1.5 w-1.5 rounded-full bg-[#a3a3a3] shadow-[0_0_8px_#a3a3a3]" />
      {children}
    </p>
  );
}

function Ring({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute left-1/2 aspect-square -translate-x-1/2 ${className}`}>
      {/* soft halo */}
      <div className="absolute inset-[-12%] rounded-full bg-[radial-gradient(closest-side,rgb(93_93_93/0.35),transparent_75%)]" />
      {/* the ring */}
      <div
        className="absolute inset-0 rounded-full border-2 border-white/80"
        style={{
          boxShadow: "0 0 30px 6px rgb(173 173 173 / 0.7), inset 0 0 40px 4px rgb(147 147 147 / 0.55), 0 0 120px 30px rgb(84 84 84 / 0.45)",
          animation: "pulse-glow 6s ease-in-out infinite",
        }}
      />
      {/* travelling highlight */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, transparent 0 62%, rgb(206 206 206 / 0.9) 74%, #fff 76%, rgb(172 172 172 / 0.7) 79%, transparent 86%)",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))",
          filter: "blur(1px) drop-shadow(0 0 10px #fff)",
          animation: "spin-slow 9s linear infinite",
        }}
      />
      {/* inner arc */}
      <div
        className="absolute inset-[22%] rounded-full"
        style={{
          background: "conic-gradient(from 200deg, transparent 0 55%, rgb(147 147 147 / 0.0) 56%, rgb(188 188 188 / 0.85) 70%, transparent 80%)",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          filter: "drop-shadow(0 0 8px rgb(173 173 173))",
          animation: "spin-slow 16s linear infinite reverse",
        }}
      />
    </div>
  );
}

export default function Home() {
  return (
    <div className="-mt-[70px] overflow-x-clip sm:-mt-[78px]">
      {/* HERO */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-end overflow-hidden pb-16 sm:pb-20">
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,#1c1c1c_0%,#0a0a0a_45%,#000000_100%)]" />
        <div className="stars" />
        <Ring className="top-[-34vw] w-[118vw] sm:top-[-26vw] sm:w-[86vw] lg:top-[-330px] lg:w-[980px]" />

        <div className="relative z-10 flex w-full max-w-6xl flex-col items-center px-4">
          <h1 aria-label="Kalypso" className="font-display flex w-full justify-between px-1 text-[13vw] leading-none font-bold text-white drop-shadow-[0_0_30px_rgb(164_164_164/0.6)] sm:text-[10vw] lg:text-[8.5rem]">
            {WORD.map((c, i) => (
              <span key={i} aria-hidden style={{ animation: `letter-in 1.1s cubic-bezier(.2,.7,.2,1) ${150 + i * 90}ms both` }}>
                {c}
              </span>
            ))}
          </h1>

          <p className="mt-10 text-center text-xl font-semibold tracking-[0.18em] text-white uppercase sm:text-2xl md:text-3xl" style={{ animation: "fade-up 1s .9s both" }}>
            Private data on a public chain
          </p>
          <p className="mt-4 max-w-2xl text-center text-[#c0c0c0] sm:text-lg" style={{ animation: "fade-up 1s 1.05s both" }}>
            On Arkiv, <code className="font-mono text-white">deleteEntity</code> only clears current state. Kalypso encrypts on your
            device, proves facts in zero knowledge, and makes deletion real by destroying the keys.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3" style={{ animation: "fade-up 1s 1.2s both" }}>
            <Link href="/app" className="nb-btn bg-ink px-8 py-3.5 text-base">
              Open the app
            </Link>
            <Link href={DEMO_PROOF} className="nb-btn glass px-8 py-3.5 text-base text-white">
              Verify a live proof →
            </Link>
          </div>
          <p className="mt-5 flex items-center gap-2 text-sm text-[#a3a3a3]" style={{ animation: "fade-up 1s 1.35s both" }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#cbcbcb] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#cbcbcb]" />
            </span>
            Live on Arkiv Rabdi · chain 7794095
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        {/* PILLARS */}
        <section className="pt-32 pb-4">
          <Reveal className="mb-12 text-center">
            <Eyebrow>What it does</Eyebrow>
            <h2 className="text-gradient text-4xl font-bold tracking-tight md:text-5xl">Four primitives, one library</h2>
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 110}>
                <article className="nb-card lift group h-full p-6">
                  <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${p.glow}, transparent)` }} />
                  <div aria-hidden className="absolute -top-16 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full opacity-30 blur-3xl transition-opacity duration-500 group-hover:opacity-60" style={{ background: p.glow }} />
                  <div className="relative">
                    <div className="flex items-center justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-xl" style={{ color: p.glow, boxShadow: `0 0 24px -6px ${p.glow}` }}>
                        {p.icon}
                      </span>
                      <span className="font-mono text-xs text-[#7a7a7a]">{p.n}</span>
                    </div>
                    <h3 className="mt-5 text-2xl font-bold text-white">{p.title}</h3>
                    <p className="mt-1 text-sm" style={{ color: p.glow }}>{p.lead}</p>
                    <ul className="mt-5 space-y-2.5 text-sm text-[#c0c0c0]">
                      {p.points.map((pt) => (
                        <li key={pt} className="flex gap-2.5">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#a3a3a3]" />
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* HOW */}
        <section id="how" className="scroll-mt-28 py-32">
          <Reveal className="mb-14 text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="text-gradient text-4xl font-bold tracking-tight md:text-5xl">From write to provable erasure</h2>
          </Reveal>
          <ol className="relative grid gap-8 md:grid-cols-5 md:gap-4">
            <div aria-hidden className="absolute top-6 right-[10%] left-[10%] hidden h-px bg-gradient-to-r from-transparent via-[#8b8b8b] to-transparent md:block" />
            {FLOW.map((f, i) => (
              <Reveal as="li" key={f.t} delay={i * 120} className="relative text-center">
                <span className="relative mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#a3a3a3]/60 bg-[#121212] font-mono text-sm font-bold text-white shadow-[0_0_24px_-2px_rgb(138_138_138/0.8)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 text-lg font-bold text-white">{f.t}</h3>
                <p className="mx-auto mt-1.5 max-w-[14rem] text-sm text-[#a3a3a3]">{f.d}</p>
              </Reveal>
            ))}
          </ol>

        </section>

        {/* QUERY */}
        <section className="pt-10 pb-28">
          <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <Eyebrow>Encrypted queries</Eyebrow>
              <h2 className="text-gradient text-4xl font-bold tracking-tight md:text-5xl">Query it like a database</h2>
              <p className="mt-4 text-[#c0c0c0]">
                Arkiv can&apos;t filter values it can&apos;t read, so we never ask it to. Each query compiles to equality checks on HMAC
                tags that Arkiv&apos;s own index answers. Measured live on Rabdi, with the same results as decrypting everything.
              </p>
            </div>
            <Link href="/docs/07-performance" className="nb-btn glass text-white">Full comparison →</Link>
          </Reveal>
          <Reveal>
            <div className="nb-card overflow-x-auto p-0">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wider text-[#7a7a7a] uppercase">
                    <th className="px-6 py-4 font-medium">Query</th>
                    <th className="px-6 py-4 font-medium">Arkiv alone, on ciphertext</th>
                    <th className="px-6 py-4 font-medium text-[#b9b9b9]">With Kalypso</th>
                  </tr>
                </thead>
                <tbody>
                  {QUERY_GAINS.map(([q, before, after]) => (
                    <tr key={q} className="border-t border-white/[0.07] transition-colors hover:bg-white/[0.03]">
                      <td className="px-6 py-4 font-medium text-white">{q}</td>
                      <td className="px-6 py-4 font-mono text-xs text-[#999999]">{before}</td>
                      <td className="px-6 py-4 font-mono text-xs text-[#cbcbcb]">{after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>

      </div>

    </div>
  );
}
