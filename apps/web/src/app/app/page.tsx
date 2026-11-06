import { VaultView } from "./vault-view";

// Rendered only after the client-side wallet gate passes (see ./app-shell.tsx).
export const instant = false;

export default function VaultPage() {
  return <VaultView />;
}
