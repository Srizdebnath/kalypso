import type { RecordStatus } from "@/lib/arkivzk-client";
import { Badge } from "./ui";

export function StatusBadge({ status }: { status: RecordStatus }) {
  if (status === "live") return <Badge tone="lime">● live</Badge>;
  if (status === "shredded") return <Badge tone="ink">✕ shredded</Badge>;
  return <Badge tone="violet">◌ expired</Badge>;
}
