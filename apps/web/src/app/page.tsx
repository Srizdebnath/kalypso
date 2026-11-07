import Link from "next/link";
import { Badge, Card } from "@/components/ui";

const PILLARS = [
  {
    n: "01",
    title: "Encrypt",
    tone: "bg-cyan",
    lead: "Plaintext never leaves your device.",
    points: [
      "AES-256-GCM in the browser, padded to size buckets so length leaks less.",
      "A fresh random key per record, split 2-of-3: your device + two guardian servers.",
      "Key shares travel to guardians wrapped with hybrid ML-KEM-768 + X25519.",
      "Large files go to Swarm encrypted with the same per-record key scheme.",
    ],
  },
  {
    n: "02",
    title: "Prove",
    tone: "bg-pink",
    lead: "Use the data without showing it.",
    points: [
      "Each record carries a salted Poseidon2 commitment, public on Arkiv.",
      "Noir circuits (UltraHonk) prove range and equality claims about a committed field.",
      "Anyone can verify a proof from Arkiv with no key and no wallet.",
      "The verifier learns the statement (e.g. age ≥ 18) and nothing else.",
    ],
  },
  {
    n: "03",
    title: "Shred",
    tone: "bg-lime",
    lead: "Delete the key, not the data.",
    points: [
      "All three key shares are destroyed: device and both guardians.",
      "Each guardian signs a destruction attestation.",
      "Entities are deleted on Arkiv and a public ShredReceipt entity is written.",
      "Copies on old nodes remain, but there is no key left to open them.",
    ],
  },
  {
    n: "04",
    title: "Query",
    tone: "bg-violet",
    lead: "A database on ciphertext.",
    points: [
      "Exact, range and COUNT queries on encrypted fields, evaluated by Arkiv on HMAC tags.",
      "Blind foreign keys: 1:N, many-to-many, JOIN, cascade shred and renew.",
      "Atomic multi-record inserts; a child never outlives its parent.",
      "Query planner with explain(), IN-batching and keyset paging.",
    ],
  },
];

const QUERY_GAINS = [
  ["Range on an encrypted field", "download + decrypt all: 3,034 ms", "1 query: 497 ms"],
  ["COUNT on an encrypted field", "decrypt every record", "1 count query, 0 rows downloaded"],
  ["Children of 5 parents (JOIN)", "5 queries: 1,826 ms", "1 query: 389 ms"],
  ["Insert patient + doctor + visit + lab", "4 txs, not atomic", "1 atomic tx"],
  ["Delete a parent and its children", "k+1 txs, found by scan", "1 tx, keys destroyed"],
  ["Proofs of 45 records", "45 queries", "3 queries"],
];

const EXPLORER = "https://rabdi.explorer.arkiv.network";
const LIVE = [
  ["Wallet used for the live runs", "address", "0xBc670380edc8Ac07E91ca68cD6ac2Adf27881162"],
  ["A shred receipt (guardian-signed)", "entity", "0x5257a663ad161985d8a85a10529de28a7982a97ee568bba65d0e73ba069b41fc"],
  ["A month (epoch) shred receipt", "entity", "0xf309ad37f75fdf7c2996ee0d360c2c25af5c14abcf3b7ca65d7bde8dba15dfbf"],
];

const FLOW = [
  { t: "Put", d: "Encrypt on device, commit with Poseidon2, split the key, write ciphertext + commitment to Arkiv." },
  { t: "Prove", d: "Generate a ZK proof over the commitment (e.g. age ≥ 18) and publish it as an entity." },
  { t: "Verify", d: "Anyone reads the proof from Arkiv and checks it in the browser. No keys involved." },
  { t: "Shred", d: "Guardians + device destroy their shares and sign. Entities deleted, receipt published." },
  { t: "Archive fails", d: "An archive node replays the old calldata it captured and tries to decrypt. It can't." },
];

const OLD_NODE = [
  ["Ciphertext from an old block", "No: needs the record key, which was destroyed"],
  ["Commitment C", "No: hiding, and the salt was destroyed with the key"],
  ["Key shares", "Never on-chain. Only device and guardians held them"],
  ["Ciphertext length", "Only the padded bucket size"],
];

const LIMITS = [
  {
    t: "Anyone who decrypted before the shred keeps what they saw.",
    d: "Shredding prevents future decryption. It cannot retract plaintext, screenshots or copies made while the key existed. No system can.",
  },
  {
    t: "Guardians are trusted to really zeroize.",
    d: "In this MVP the guardians are simple services holding shares in memory. Threshold splitting means one lying guardian alone is not enough, but you are trusting their deletion. TEE attestation is future work.",
  },
  {
    t: "Exported or backed-up shares must be shredded too.",
    d: "If you copied key material out of the app yourself, arkivzk cannot reach it.",
  },
  {
    t: "Published metadata stays in history.",
    d: "Timestamps, schema id, owner address and the padded size bucket are public on Arkiv and remain in old blocks after a shred.",
  },
  {
    t: "Old proofs stay mathematically valid.",
    d: "A proof was true when it was made. Verifiers must check the record's shred status (this app does) and treat shredded records as revoked.",
  },
  {
    t: "Search indexes leak patterns, by design.",
    d: "Opt-in only. An equality tag shows which of your records in the same month share a value; a range tag shows approximate order within a month; a foreign key shows siblings. Values never leave your device.",
  },
  {
    t: "Malware on your device is out of scope.",
    d: "Encryption happens on your device, so whoever controls the device sees the plaintext.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* HERO */}
      <section className="grid gap-10 py-14 md:grid-cols-[1.25fr_1fr] md:items-center md:py-20">
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap gap-2">
            <Badge tone="yellow">TypeScript library</Badge>
            <Badge tone="white">for Arkiv DB-chain</Badge>
          </div>
          <h1 className="text-5xl font-bold leading-[0.95] tracking-tight md:text-7xl">
            Private data on a{" "}
            <span className="relative inline-block">
              <span className="relative z-10">public</span>
              <span className="absolute inset-x-0 bottom-1 z-0 h-4 bg-pink md:h-6" aria-hidden />
            </span>{" "}
            database.
          </h1>
          <p className="mt-6 max-w-xl text-lg md:text-xl">
            Arkiv stores everything in the open, and <code className="font-mono font-bold">deleteEntity</code>{" "}
            only removes data from current state: anyone who synced the old blocks still has it.
            arkivzk encrypts on your device, lets you prove facts about your data in zero knowledge,
            and makes deletion real by destroying the keys.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="nb-btn bg-lime px-6 py-3 text-base">
              Open the app →
            </Link>
            <Link href="/docs" className="nb-btn bg-white px-6 py-3 text-base">
              Read the docs
            </Link>
            <Link href="/archive" className="nb-btn bg-yellow px-6 py-3 text-base">
              Try to break it
            </Link>
          </div>
        </div>

        <div className="nb-card min-w-0 rotate-1 bg-ink p-0 text-paper">
          <div className="flex items-center gap-2 border-b-[3px] border-paper/20 px-4 py-2 font-mono text-xs">
            <span className="h-3 w-3 border-2 border-paper bg-danger" />
            <span className="h-3 w-3 border-2 border-paper bg-yellow" />
            <span className="h-3 w-3 border-2 border-paper bg-lime" />
            <span className="ml-2 opacity-70">@arkivzk/sdk</span>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[0.8rem] leading-relaxed">
            <code>
              <span className="text-cyan">const</span> {"{ entityKey }"} = <span className="text-cyan">await</span> zk.<span className="text-yellow">put</span>({"{"}{"\n"}
              {"  "}schemaId: <span className="text-lime">&quot;medical.v1&quot;</span>, values: {"{ age: 25 }"},{"\n"}
              {"  "}rangeField: <span className="text-lime">&quot;age&quot;</span>, retentionSeconds{"\n"}
              {"}"}){"\n\n"}
              <span className="text-paper/50">{"// zero-knowledge claim, published on Arkiv"}</span>{"\n"}
              <span className="text-cyan">await</span> zk.<span className="text-yellow">prove</span>(entityKey, {"{ field: "}<span className="text-lime">&quot;age&quot;</span>{", min: 18 }"}, nonce){"\n\n"}
              <span className="text-paper/50">{"// anyone, no key needed"}</span>{"\n"}
              <span className="text-cyan">await</span> <span className="text-yellow">verifyProofEntity</span>(publicClient, proofKey){"\n\n"}
              <span className="text-paper/50">{"// Arkiv filters ciphertext tags, never values"}</span>{"\n"}
              <span className="text-cyan">await</span> zk.<span className="text-yellow">searchRange</span>(<span className="text-lime">&quot;medical.v1&quot;</span>, <span className="text-lime">&quot;age&quot;</span>, 18, 40){"\n\n"}
              <span className="text-paper/50">{"// gone for everyone, children too"}</span>{"\n"}
              <span className="text-cyan">await</span> zk.<span className="text-pink">shred</span>([entityKey], onStep, {"{ cascade: true }"})
            </code>
          </pre>
        </div>
      </section>

      {/* PILLARS */}
      <section className="py-10">
        <h2 className="mb-8 text-3xl font-bold md:text-4xl">Four pillars</h2>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {PILLARS.map((p) => (
            <article key={p.title} className="nb-card flex flex-col p-0">
              <header className={`${p.tone} border-b-[3px] border-ink p-5`}>
                <span className="font-mono text-sm font-bold">{p.n}</span>
                <h3 className="text-3xl font-bold">{p.title}</h3>
                <p className="mt-1 font-medium">{p.lead}</p>
              </header>
              <ul className="space-y-3 p-5 text-[0.95rem]">
                {p.points.map((pt) => (
                  <li key={pt} className="flex gap-2">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 bg-ink" aria-hidden />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* FLOW */}
      <section className="py-10">
        <h2 className="mb-8 text-3xl font-bold md:text-4xl">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-5">
          {FLOW.map((f, i) => (
            <li key={f.t} className="nb-card relative p-4">
              <span className="absolute -top-4 -left-3 grid h-9 w-9 place-items-center border-[3px] border-ink bg-yellow font-mono font-bold">
                {i + 1}
              </span>
              <h3 className="mt-2 text-xl font-bold">{f.t}</h3>
              <p className="mt-2 text-sm">{f.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* OLD NODE + NUMBERS */}
      <section className="grid gap-6 py-10 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="text-2xl font-bold">What an old node runner has after a shred</h2>
          <p className="mt-2 text-sm">
            They synced every block, so they keep every byte that was ever written. That is fine,
            because none of it is a key.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-[3px] border-ink text-sm">
              <thead>
                <tr className="bg-lime">
                  <th className="border-2 border-ink p-2 text-left">They have</th>
                  <th className="border-2 border-ink p-2 text-left">Can they read it?</th>
                </tr>
              </thead>
              <tbody>
                {OLD_NODE.map(([a, b]) => (
                  <tr key={a}>
                    <td className="border-2 border-ink p-2 font-medium">{a}</td>
                    <td className="border-2 border-ink p-2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/archive" className="nb-btn mt-5 bg-yellow">
            See it on the archive node page →
          </Link>
        </Card>

        <Card tone="violet">
          <h2 className="text-2xl font-bold">Proof numbers</h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide">
            Measured on a laptop (Node, warm)
          </p>
          <dl className="mt-5 space-y-4">
            {[
              ["0.4–0.6 s", "proof generation"],
              ["15 ms", "verification"],
              ["14.6 KB", "proof size"],
              ["3.7 KB", "verification key (stored once)"],
            ].map(([v, k]) => (
              <div key={k} className="nb-border flex items-baseline justify-between gap-3 bg-white p-3">
                <dt className="text-sm font-medium">{k}</dt>
                <dd className="font-mono text-2xl font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs">
            The first proof in a fresh tab also loads the WASM prover. In our browser run, proving plus publishing
            the proof on Arkiv took about 30 s, mostly waiting for the transaction.
          </p>
        </Card>
      </section>

      {/* QUERY */}
      <section className="py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold md:text-4xl">Query it like a database</h2>
            <p className="mt-2">
              Arkiv can&apos;t filter, count or join values it can&apos;t read, so we never ask it to. arkivzk turns each
              query into equality checks on HMAC tags that Arkiv&apos;s own index can answer. Measured live on Rabdi,
              same results as decrypting everything.
            </p>
          </div>
          <Link href="/docs/07-performance#5-queries-what-arkiv-does-what-it-cant-do-on-encrypted-data-and-what-arkivzk-adds" className="nb-btn bg-violet">
            Full comparison →
          </Link>
        </div>
        <div className="nb-card overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="bg-ink text-left text-paper">
                <th className="p-3">Query</th>
                <th className="p-3">Arkiv alone, on encrypted data</th>
                <th className="p-3">arkivzk</th>
              </tr>
            </thead>
            <tbody>
              {QUERY_GAINS.map(([q, before, after]) => (
                <tr key={q} className="border-t-[3px] border-ink">
                  <td className="p-3 font-bold">{q}</td>
                  <td className="p-3 font-mono text-xs">{before}</td>
                  <td className="bg-lime/60 p-3 font-mono text-xs font-bold">{after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* LIVE */}
      <section className="py-10">
        <div className="nb-card p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold md:text-3xl">Live on Arkiv Rabdi</h2>
            <Badge tone="lime">chain 7794095</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm">
            Every flow on this site ran against the real testnet. Open these in the explorer, or run{" "}
            <code className="font-mono font-bold">node packages/sdk/e2e.mjs</code> yourself.
          </p>
          <ul className="mt-5 space-y-3">
            {LIVE.map(([label, kind, value]) => (
              <li key={value} className="nb-border flex flex-col gap-1 bg-paper p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-bold">{label}</span>
                <a
                  href={`${EXPLORER}/${kind}/${value}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-xs underline decoration-2"
                >
                  {value}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* WHY FAST */}
      <section className="py-10">
        <div className="nb-card flex flex-col gap-5 bg-cyan p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold md:text-4xl">Why it&apos;s fast</h2>
            <p className="mt-2">
              Time and space complexity of each operation, plus before-vs-after tables for the
              optimizations we made.
            </p>
          </div>
          <Link href="/docs/07-performance" className="nb-btn shrink-0 bg-white px-6 py-3 text-base">
            Read the performance notes →
          </Link>
        </div>
      </section>

      {/* LIMITS */}
      <section id="limits" className="py-10">
        <div className="nb-card bg-yellow p-6 md:p-8">
          <h2 className="text-3xl font-bold md:text-4xl">Limits</h2>
          <p className="mt-2 max-w-3xl">
            What arkivzk does <strong>not</strong> protect against. This is a hackathon build: the
            code is not audited.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {LIMITS.map((l) => (
              <div key={l.t} className="nb-border bg-white p-4 md:last:odd:col-span-2">
                <h3 className="font-bold">{l.t}</h3>
                <p className="mt-1 text-sm">{l.d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm">
            Full threat model in{" "}
            <Link href="/docs/01-idea" className="font-bold underline decoration-[3px]">
              01 · Idea, threat model, promises
            </Link>{" "}
            and{" "}
            <Link href="/docs/04-crypto-shredding" className="font-bold underline decoration-[3px]">
              04 · Crypto-shredding
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
