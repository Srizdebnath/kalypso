"use client";

import Link from "next/link";
import { getReceipt, type ShredReceiptView } from "@/lib/arkivzk-client";
import { useAsync } from "@/lib/use-async";
import { Card, ErrorBox, Loading } from "@/components/ui";
import { ReceiptCard } from "@/components/receipt-card";

export function ReceiptView({ receiptKey }: { receiptKey: string }) {
  const { data, error, loading, reload } = useAsync<ShredReceiptView>(() => getReceipt(receiptKey), receiptKey);

  return (
    <div className="space-y-6">
      {loading && (
        <Card>
          <Loading label="Reading receipt from Arkiv and checking signatures" />
        </Card>
      )}
      {error && <ErrorBox title="Could not load receipt" error={error} onRetry={reload} />}
      {data && !loading && <ReceiptCard receipt={data} showLink={false} />}
      <Card tone="yellow">
        <h2 className="font-bold">What a receipt does and doesn&apos;t prove</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>It proves each guardian signed a statement that it destroyed its share.</li>
          <li>
            It can&apos;t prove the guardian really erased memory. In this MVP that is trust in the
            guardians, reduced by the 2-of-3 threshold.
          </li>
          <li>It can&apos;t take back plaintext someone decrypted before the shred.</li>
        </ul>
        <p className="mt-3 text-sm">
          <Link href="/archive" className="font-bold underline">
            Check the archive node: old copies can&apos;t be decrypted →
          </Link>
        </p>
      </Card>
    </div>
  );
}
