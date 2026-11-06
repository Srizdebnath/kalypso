import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/ui";
import { ReceiptView } from "./receipt-view";

export const metadata: Metadata = { title: "Shred receipt" };

export default function ReceiptPage({ params }: PageProps<"/receipt/[key]">) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader kicker="public · no wallet needed" title="Shred receipt" tone="lime">
        A ShredReceipt is an Arkiv entity written when keys are destroyed. Each guardian signs that
        it destroyed its key share; this page checks those signatures.
      </PageHeader>
      <Suspense fallback={<Loading label="Reading link" />}>
        {params.then(({ key }) => (
          <ReceiptView receiptKey={decodeURIComponent(key)} />
        ))}
      </Suspense>
    </div>
  );
}
