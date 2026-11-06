# Arkiv friction log (written live while building arkivzk)

Each entry: what we expected, what happened, how to reproduce.

## 1. `deleteEntity` is not erasure, and the docs could say so louder
- **Expected:** a clear warning on the delete page that calldata of the create tx stays in history and in every archive/indexer.
- **Happened:** docs say "the entity is gone, as if it had expired". True for current state, but a builder handling personal data can read this as erasure. The privacy skill does say "Expiration does not limit copies already read or guarantee secure erasure", but that is not on the delete page.
- **Repro:** create entity → delete → read the create tx input via `eth_getTransactionByHash` on any node: payload is still there.
- **Suggestion:** one sentence + link to a crypto-shredding pattern on docs/writing/change.

## 2. Schema column types can't be named in emitted declarations (SDK 1.0.1)
- **Expected:** `export const S = defineSchema("x", { a: str().indexed() })` in a library package builds with `declaration: true`.
- **Happened:** `TS4023: Exported variable 'S' has or is using name 'ColumnProperties' from external module ".../dist/index-DaMIgZgJ" but cannot be named.` `ColumnProperties` (src/schema/column.ts:59) is not exported, and the d.ts chunk has a hashed file name.
- **Repro:** any TS package with `declaration: true` exporting a `defineSchema` result.
- **Workaround:** we disable declarations for the schema package and point `types` at the TS source.
- **Suggestion:** export `ColumnProperties` (or make `Column` self-contained).

## 3. No public, non-signing gas estimator for creates/batches
- **Expected:** `publicClient.estimateBatch({...})` or similar.
- **Happened:** SDK 1.0.x estimates internally only inside the send path. To follow the recommended explicit-gas policy we wrap a fake wallet transport that intercepts `eth_estimateGas` and throws to stop before signing (see packages/core/src/tx.ts).
- **Suggestion:** expose `estimateExecute(operations)` on the public client.

## 4. Access key lives in the RPC URL path
- **Expected:** header-based auth so keys don't leak into logs, error messages, and browser wallets' RPC config.
- **Happened:** `rabdi({ accessKey })` puts the key in the URL; any viem error that prints the URL prints the key. We had to build a server-side `/api/rpc` proxy so the browser never sees it.
