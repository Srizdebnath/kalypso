import Link from "next/link";
import { CountUp, Reveal } from "@/components/motion";

const WORD = "ARKIVZK".split("");

const TECH = ["AES-256-GCM", "Noir · UltraHonk", "Poseidon2", "ML-KEM-768 + X25519", "Shamir 2-of-3", "HMAC blind indexes", "Swarm", "Arkiv DB-chain", "Ed25519 receipts"];

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

const STATS = [
  { to: 6.1, decimals: 1, suffix: "×", label: "faster range search on encrypted data", note: "3,034 → 497 ms, live" },
  { to: 1, prefix: "5→", label: "queries for a JOIN, down to one", note: "1,826 → 389 ms" },
  { to: 1, suffix: " tx", label: "to shred a parent and all its children", note: "atomic, with receipt" },
  { to: 14.6, decimals: 1, suffix: " KB", label: "per zero-knowledge proof", note: "prove ≈0.4 s, verify 15 ms" },
];

const QUERY_GAINS = [
  ["Range on an encrypted field", "Download + decrypt all · 3,034 ms", "1 query · 497 ms"],
  ["COUNT on an encrypted field", "Decrypt every record", "1 count query · 0 rows"],
  ["Children of 5 parents (JOIN)", "5 queries · 1,826 ms", "1 query · 389 ms"],
  ["Insert patient + doctor + visit + lab", "4 txs, not atomic", "1 atomic tx"],
  ["Delete a parent and its children", "k+1 txs, found by scan", "1 tx, keys destroyed"],
  ["Proofs of 45 records", "45 queries", "3 queries"],
];

const EXPLORER = "https://rabdi.explorer.arkiv.network";
const LIVE = [
  ["Wallet used for the live runs", "address", "0xBc670380edc8Ac07E91ca68cD6ac2Adf27881162"],
  ["A guardian-signed shred receipt", "entity", "0x5257a663ad161985d8a85a10529de28a7982a97ee568bba65d0e73ba069b41fc"],
  ["A month-level shred receipt", "entity", "0xf309ad37f75fdf7c2996ee0d360c2c25af5c14abcf3b7ca65d7bde8dba15dfbf"],
];

const LIMITS = [
  ["Anyone who decrypted before the shred keeps what they saw.", "Shredding stops future decryption. It can't take back plaintext, screenshots or copies made while the key existed."],
  ["Guardians are trusted to really delete.", "Two-of-three means one lying guardian alone isn't enough, but two colluding guardians could keep a key. TEE attestation is future work."],
  ["Search indexes leak patterns, by design.", "Opt-in per field. Equality tags show which of your records share a value in the same month; range tags show approximate order; foreign keys show siblings."],
  ["Published metadata stays in history.", "Timestamps, schema id, owner address and the padded size bucket are public on Arkiv and remain in old blocks."],
  ["Old proofs stay mathematically valid.", "A proof was true when it was made. Verifiers must check shred status (this app does) and treat shredded records as revoked."],
  ["Malware on your device is out of scope.", "Encryption happens on your device, so whoever controls it sees the plaintext. The code is not audited."],
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
    <div className="-mt-14 overflow-x-clip">
      {/* HERO */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-end overflow-hidden pb-16 sm:pb-20">
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,#1c1c1c_0%,#0a0a0a_45%,#000000_100%)]" />
        <div className="stars" />
        <Ring className="top-[-34vw] w-[118vw] sm:top-[-26vw] sm:w-[86vw] lg:top-[-330px] lg:w-[980px]" />

        <div className="relative z-10 flex w-full max-w-6xl flex-col items-center px-4">
          <h1 aria-label="arkivzk" className="font-display flex w-full justify-between px-1 text-[13vw] leading-none font-bold text-white drop-shadow-[0_0_30px_rgb(164_164_164/0.6)] sm:text-[10vw] lg:text-[8.5rem]">
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
            On Arkiv, <code className="font-mono text-white">deleteEntity</code> only clears current state. arkivzk encrypts on your
            device, proves facts in zero knowledge, and makes deletion real by destroying the keys.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3" style={{ animation: "fade-up 1s 1.2s both" }}>
            <Link href="/app" className="nb-btn bg-ink px-8 py-3.5 text-base">
              Open the app
            </Link>
            <Link href="/docs/00-getting-started" className="nb-btn glass px-8 py-3.5 text-base text-white">
              Get started →
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

      {/* TECH MARQUEE */}
      <section aria-label="Built with" className="relative border-y border-white/10 bg-white/[0.02] py-5">
        <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
          <div className="flex w-max gap-12 whitespace-nowrap" style={{ animation: "marquee 38s linear infinite" }}>
            {[...TECH, ...TECH].map((t, i) => (
              <span key={i} className="flex items-center gap-12 font-mono text-sm tracking-wider text-[#999999]">
                {t}
                <span className="text-[#5b5b5b]">✦</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        {/* PROBLEM */}
        <section className="grid items-center gap-12 py-28 md:grid-cols-2">
          <Reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="text-gradient text-4xl leading-tight font-bold tracking-tight md:text-5xl">
              On a public chain, delete doesn&apos;t erase.
            </h2>
            <p className="mt-5 text-lg text-[#c0c0c0]">
              Arkiv stores attributes, owners and full transaction history in the open. Removing an entity drops it from current
              state, but every node and archive that synced the old blocks still has the bytes.
            </p>
            <p className="mt-4 text-lg text-[#c0c0c0]">
              arkivzk makes those bytes useless: only ciphertext ever goes on-chain, and the key lives in three shares that can
              all be destroyed with a signed receipt.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="nb-card p-0 font-mono text-[0.8rem] leading-relaxed">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5c7a]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#d5d5d5]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#cbcbcb]" />
                <span className="ml-2 text-xs text-[#7a7a7a]">what the archive page shows</span>
              </div>
              <div className="space-y-2 p-5">
                <p><span className="text-[#7a7a7a]">$</span> zk.shred([record])</p>
                <p className="pl-4 text-[#cbcbcb]">✓ guardian-1 zeroized share · signed</p>
                <p className="pl-4 text-[#cbcbcb]">✓ guardian-2 zeroized share · signed</p>
                <p className="pl-4 text-[#cbcbcb]">✓ entity deleted · public receipt written</p>
                <p className="pt-3"><span className="text-[#7a7a7a]">$</span> archive.replay(record.createTx)</p>
                <p className="pl-4 text-[#cbcbcb]">→ ciphertext recovered from old calldata</p>
                <p className="pl-4 text-[#cbcbcb]">→ key shares available · 0 of 3</p>
                <p className="pl-4 text-[#ff5c7a]">✕ decrypt failed: no key exists anywhere</p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* PILLARS */}
        <section className="py-10">
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
        <section id="how" className="scroll-mt-28 py-28">
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

          <Reveal className="mt-20">
            <div className="grid items-center gap-10 md:grid-cols-[1fr_1.2fr]">
              <div>
                <h3 className="text-3xl font-bold text-white">Five calls in TypeScript</h3>
                <p className="mt-3 text-[#c0c0c0]">
                  The SDK wraps encryption, key custody, proofs, queries and shredding. Your app passes values. Arkiv only ever sees
                  ciphertext, commitments and HMAC tags.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/docs/06-sdk-reference" className="nb-btn glass text-white">SDK reference</Link>
                  <Link href="/docs/api" className="nb-btn glass text-white">Client API</Link>
                </div>
              </div>
              <div className="nb-card p-0">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 font-mono text-xs text-[#7a7a7a]">
                  <span>app.ts</span>
                  <span>@arkivzk/sdk</span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[0.8rem] leading-relaxed text-[#dcdcdc]">
                  <code>
                    <span className="text-[#7a7a7a]">{"// encrypt on device, range-searchable"}</span>{"\n"}
                    <span className="text-[#b6b6b6]">const</span> {"{ entityKey }"} = <span className="text-[#b6b6b6]">await</span> zk.<span className="text-[#d5d5d5]">put</span>({"{"} schemaId, values: {"{ age: 25 }"}, rangeField: <span className="text-[#cbcbcb]">&quot;age&quot;</span> {"}"}){"\n\n"}
                    <span className="text-[#7a7a7a]">{"// zero-knowledge claim, published on Arkiv"}</span>{"\n"}
                    <span className="text-[#b6b6b6]">await</span> zk.<span className="text-[#d5d5d5]">prove</span>(entityKey, {"{ field: "}<span className="text-[#cbcbcb]">&quot;age&quot;</span>{", min: 18 }"}, nonce){"\n\n"}
                    <span className="text-[#7a7a7a]">{"// anyone, no key needed"}</span>{"\n"}
                    <span className="text-[#b6b6b6]">await</span> <span className="text-[#d5d5d5]">verifyProofEntity</span>(publicClient, proofKey){"\n\n"}
                    <span className="text-[#7a7a7a]">{"// Arkiv filters tags, never values"}</span>{"\n"}
                    <span className="text-[#b6b6b6]">await</span> zk.<span className="text-[#d5d5d5]">searchRange</span>(schemaId, <span className="text-[#cbcbcb]">&quot;age&quot;</span>, 18, 40){"\n\n"}
                    <span className="text-[#7a7a7a]">{"// gone for everyone, children too"}</span>{"\n"}
                    <span className="text-[#b6b6b6]">await</span> zk.<span className="text-[#a2a2a2]">shred</span>([entityKey], onStep, {"{ cascade: true }"})
                  </code>
                </pre>
              </div>
            </div>
          </Reveal>
        </section>

        {/* STATS */}
        <section className="py-10">
          <div className="grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 100} className="h-full">
                <div className="h-full bg-[#0c0c0c] p-7">
                  <p className="text-gradient font-display text-4xl font-bold">
                    <CountUp to={s.to} decimals={s.decimals ?? 0} prefix={s.prefix} suffix={s.suffix} />
                  </p>
                  <p className="mt-3 text-sm text-white">{s.label}</p>
                  <p className="mt-1 font-mono text-xs text-[#7a7a7a]">{s.note}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* QUERY */}
        <section className="py-28">
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
                    <th className="px-6 py-4 font-medium text-[#b9b9b9]">With arkivzk</th>
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

        {/* BREAK IT + LIVE */}
        <section className="grid gap-5 lg:grid-cols-2">
          <Reveal className="h-full">
            <div className="nb-card h-full p-8">
              <div aria-hidden className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full border border-white/20 shadow-[0_0_60px_10px_rgb(111_111_111/0.35),inset_0_0_40px_rgb(111_111_111/0.4)]" />
              <div className="relative">
                <Eyebrow>Try to break it</Eyebrow>
                <h2 className="text-3xl font-bold text-white">Run the archive node attack</h2>
                <p className="mt-3 max-w-md text-[#c0c0c0]">
                  Our indexer captured raw calldata for every arkivzk write. Pick a shredded record and watch it fail to decrypt:
                  the ciphertext is there, the key isn&apos;t.
                </p>
                <Link href="/archive" className="nb-btn bg-ink mt-8">Open the archive node →</Link>
              </div>
            </div>
          </Reveal>
          <Reveal delay={120} className="h-full">
            <div className="nb-card h-full p-8">
              <Eyebrow>Live on Rabdi</Eyebrow>
              <h2 className="text-3xl font-bold text-white">Check the chain yourself</h2>
              <ul className="mt-6 space-y-3">
                {LIVE.map(([label, kind, value]) => (
                  <li key={value}>
                    <a
                      href={`${EXPLORER}/${kind}/${value}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-[#a3a3a3]/60"
                    >
                      <span className="flex items-center justify-between text-sm text-white">
                        {label}
                        <span className="text-[#7a7a7a] transition-transform group-hover:translate-x-1">↗</span>
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-[#999999]">{value}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* LIMITS */}
        <section id="limits" className="py-28">
          <Reveal className="mb-10 max-w-2xl">
            <Eyebrow>Limits</Eyebrow>
            <h2 className="text-gradient text-4xl font-bold tracking-tight md:text-5xl">What it doesn&apos;t protect against</h2>
            <p className="mt-4 text-[#c0c0c0]">
              A hackathon build, research-grade and not audited. Full threat model in{" "}
              <Link href="/docs/01-idea" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">01 · Idea</Link>{" "}
              and{" "}
              <Link href="/docs/08-design-faq" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">08 · Design FAQ</Link>.
            </p>
          </Reveal>
          <div className="grid gap-3 md:grid-cols-2">
            {LIMITS.map(([t, d], i) => (
              <Reveal key={t} delay={(i % 2) * 80}>
                <details className="group nb-border bg-white/[0.02] p-5 transition-colors open:border-[#a3a3a3]/40 open:bg-white/[0.04]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white">
                    {t}
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-[#b9b9b9] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-[#a3a3a3]">{d}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>
      </div>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden py-32">
        <Ring className="top-1/2 w-[640px] max-w-[140vw] -translate-y-1/2 opacity-70" />
        <Reveal className="relative z-10 mx-auto max-w-2xl px-4 text-center">
          <h2 className="text-gradient text-4xl font-bold tracking-tight md:text-6xl">Running in ten minutes</h2>
          <p className="mt-5 text-lg text-[#cbcbcb]">Clone, set one access key, start two guardians and the app. Everything runs against the real testnet.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/docs/00-getting-started" className="nb-btn bg-ink px-8 py-3.5 text-base">Getting started</Link>
            <Link href="/app" className="nb-btn glass px-8 py-3.5 text-base text-white">Open the app</Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
