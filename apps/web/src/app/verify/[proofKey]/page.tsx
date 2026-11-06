import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/ui";
import { VerifyView } from "./verify-view";

export const metadata: Metadata = { title: "Verify proof" };

export default function VerifyPage({ params }: PageProps<"/verify/[proofKey]">) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader kicker="public · no wallet needed" title="Verify a proof" tone="pink">
        This page reads a proof from Arkiv and checks it in your browser against the record&apos;s
        public commitment. No keys are involved, and you learn only the statement.
      </PageHeader>
      <Suspense fallback={<Loading label="Reading link" />}>
        {params.then(({ proofKey }) => (
          <VerifyView proofKey={decodeURIComponent(proofKey)} />
        ))}
      </Suspense>
    </div>
  );
}
