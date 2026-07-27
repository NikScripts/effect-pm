# Store cutover — Daemon (adopt the transform-layer machinery)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Status: **done** on `cursor/store-extend-tier-refactor-a009`. Daemon uses the golden store pattern:
`builtInDaemonStoreContract` (tier 1), `Store.effects` + `Store.catchWriteErrors` +
`Store.provideContext`, direct `event.append` via `store.record`, and `Hyperlink.builtHyperlink` for
`layer` / `serve` / `serveRemote`. Execution event `_tag` values are `Started` / `Completed` /
`Failed` / `Interrupted` (no `Run` prefix — aligned with Gate facts and Queue worker events).

Read first: `docs/guides/store.md`, `docs/guides/process.md`, `docs/guides/queue-resource.md`.

## What changed in the store API

- `Store.withStorage` / `Store.withDefault` → **`Store.resolve` / `Store.resolveOrDie`** (aliases removed).
- The scope bridge is the co-located **`Store.Storage`** service, resolved as a declared dependency.
- **Honest write typing:** writes carry **`StoreWriteError`**; reads carry `StoreJournalDecodeError`.
- **Transform layer:** `Store.catchWriteErrors` = one guard for all writes.
- **Two-tier stores:** lean base (`record` / `events` / `hasPriorExecutions`) + analytics read-extension
  on `Daemon.store(tag)`. No engine tier-2 custom writes — the engine builds rows and calls `record`.
- **Typed full-capture:** tag `success` / `error` slots drive persisted `Completed.success` and `Failed.error`.

## Completed

- **`processStoreTap.ts` deleted** — store wiring inlined in `Daemon.ts` (`buildProcessImpl`).
- **`ProcessExecutionStore` facet deleted** — use `Daemon.store(tag)` on `Store.Service`.
- **Engine writes** — `builtInDaemonStoreContract` + `store.record({ _tag: "Started", … })` at run boundaries.
- **Storage discharge** — `Store.provideContext(storeEffects, storageContext)` once at build.
- **Resource bundle** — `Hyperlink.builtHyperlink` + `Hyperlink.grantLocal` in `layer`; `serve` / `serveRemote`
  defer discharge per wire call.
- **Event tags** — `Started` / `Completed` / `Failed` / `Interrupted` (BREAKING rename from `Run*`).

## Toolkit layers vs `Daemon.make`

| Entry | Auto-append execution events? |
|-------|-------------------------------|
| **`Daemon.layer` / `serve` / `serveRemote`** | **Yes** — default in-memory store merged into the layer |
| **`Daemon.make`** | **No** — supervisor only; use `layer` or call `store.record` yourself |

## Verify

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/process-store-*.test.ts test/process-built-resource.test-d.ts test/store-event-tags.test.ts
```
