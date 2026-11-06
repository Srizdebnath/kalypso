import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { ArchiveView } from "./archive-view";

export const metadata: Metadata = { title: "Archive node" };

export default function ArchivePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader kicker="break it · anyone can try" title="The old node runner's view" tone="yellow">
        An archive indexer copies the raw calldata of every arkivzk transaction as it lands on
        Arkiv, the same way any node runner who keeps history would. Deleting an entity on Arkiv
        doesn&apos;t touch these copies. Pick one and try to decrypt it.
      </PageHeader>

      <div className="mb-10 grid gap-5 md:grid-cols-3">
        <Card tone="cyan">
          <h2 className="font-bold">What&apos;s captured</h2>
          <p className="mt-1 text-sm">
            Raw transaction calldata: ciphertext, commitment, public attributes. Kept on disk even
            after the entity is deleted or expires on Arkiv.
          </p>
        </Card>
        <Card tone="pink">
          <h2 className="font-bold">What &quot;try to decrypt&quot; does</h2>
          <p className="mt-1 text-sm">
            Runs a decryption attempt using everything an archive node can get its hands on, and
            prints every step in the log.
          </p>
        </Card>
        <Card tone="lime">
          <h2 className="font-bold">What to expect</h2>
          <p className="mt-1 text-sm">
            Before a shred, the key shares still exist but live off-chain. After a shred, they
            don&apos;t exist anywhere. Either way, the archive alone holds no key.{" "}
            <Link href="/docs/04-crypto-shredding" className="font-bold underline">
              Why
            </Link>
          </p>
        </Card>
      </div>

      <ArchiveView />
    </div>
  );
}
