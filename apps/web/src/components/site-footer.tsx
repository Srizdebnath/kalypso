import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-[3px] border-ink bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xl font-bold">arkivzk</p>
          <p className="text-sm opacity-80">
            Hackathon project · ETHGlobal Mumbai · Arkiv track. Research-grade, not audited.
          </p>
        </div>
        <nav className="flex flex-wrap gap-4 font-mono text-sm">
          <Link className="hover:text-yellow" href="/docs">/docs</Link>
          <Link className="hover:text-yellow" href="/docs/api">/docs/api</Link>
          <Link className="hover:text-yellow" href="/app">/app</Link>
          <Link className="hover:text-yellow" href="/archive">/archive</Link>
        </nav>
      </div>
    </footer>
  );
}
