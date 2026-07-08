# Store cutover — Process (adopt the transform-layer machinery)

Status: **done** on `cursor/store-extend-tier-refactor-a009`. Process uses the golden store pattern:
`builtInProcessStoreContract` (tier 1), `Store.effects` + `Store.catchWriteErrors` +
`Store.provideContext`, direct `event.append` via `store.record`, and `Resource.builtResource` for
`layer` / `serve` / `serveRemote`. Execution event `_tag` values are `Started` / `Completed` /
`Failed` / `Interrupted` (no `Run` prefix — aligned with RunResource facts and Queue worker events).

Read first: `docs/guides/store.md`, `docs/guides/process.md`, `docs/guides/queue-resource.md`.

## What changed in the store API

- `Store.withStorage` / `Store.withDefault` → **`Store.resolve` / `Store.resolveOrDie`** (aliases removed).
- The scope bridge is the co-located **`Store.Storage`** service, resolved as a declared dependency.
- **Honest write typing:** writes carry **`StoreWriteError`**; reads carry `StoreJournalDecodeError`.
- **Transform layer:** `Store.catchWriteErrors` = one guard for all writes.
- **Two-tier stores:** lean base (`record` / `events` / `hasPriorExecutions`) + analytics read-extension
  on `Process.store(tag)`. No engine tier-2 custom writes — the engine builds rows and calls `record`.
- **Typed full-capture:** tag `success` / `error` slots drive persisted `Completed.success` and `Failed.error`.

## Completed

- **`processStoreTap.ts` deleted** — store wiring inlined in `Process.ts` (`buildProcessImpl`).
- **`ProcessExecutionStore` facet deleted** — use `Process.store(tag)` on `Store.Service`.
- **Engine writes** — `builtInProcessStoreContract` + `store.record({ _tag: "Started", … })` at run boundaries.
- **Storage discharge** — `Store.provideContext(storeEffects, storageContext)` once at build.
- **Resource bundle** — `Resource.builtResource` + `Resource.grantLocal` in `layer`; `serve` / `serveRemote`
  defer discharge per wire call.
- **Event tags** — `Started` / `Completed` / `Failed` / `Interrupted` (BREAKING rename from `Run*`).

## Toolkit layers vs `Process.make`

| Entry | Auto-append execution events? |
|-------|-------------------------------|
| **`Process.layer` / `serve` / `serveRemote`** | **Yes** — default in-memory store merged into the layer |
| **`Process.make`** | **No** — supervisor only; use `layer` or call `store.record` yourself |

## Verify

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/process-store-*.test.ts test/process-built-resource.test-d.ts test/store-event-tags.test.ts
```
