# Review — `cursor/run-resource-hardening-a009` (RunResource hardening + store cutover)

Reviewed 2026-07-07 against `cursor/integration-result-schema-a3ad`. Companion to
`process-store-cutover-review.md` and `store-cutover-00-store-core.md`.

## Verdict: the cleanest of the three store cutovers (queue / process / run)
Nothing blocking. Land it. Everything below is polish + one owner decision.

## What's good (keep)
- **Declared-dependency resolution, no `serviceOption`.** `makeRunResourceStoreTap` does
  `yield* StoreScopeBridgeTag` + `bridge.at(scopeKey, contract)` — the lazy `resolveNewStoreHandle`
  (`serviceOption` + `.pipe(Effect.option)`) that store-core §2 flagged is **gone**. Correct migration.
- **No casts, no `any`.** The earlier `handle.value as unknown as StoreHandleFromContract<…>` is
  removed — the store tightening made the handle precise, and they took the win.
- **`layerDefaultMemory` baked into `layer`/`serve`/`Service`**, `RunResourceStore` facet deleted,
  legacy engine writes dropped.
- **No serialization risk — the schemas are entirely JSON-safe primitives.** `runStarted/Completed/
  Failed` facts and `runStateChange` use only `Schema.String` / `Schema.Number` / `Schema.Literal`;
  `runFailedFactSchema.cause` is `Schema.String` (stringified). So it round-trips through the current
  journal codec with no help — unlike the queue (`DateTime`/`Exit`/`Cause`) and process (`result`).
- **Good hardening**: pure `runResourceStatus` / `runResourceFacts` helpers extracted + unit-tested
  (`run-resource-pure.test.ts`), safer interrupt accounting, store-tap test, `.test-d` coverage.
- **Public `Store.layerDefaultMemory` export** (Store.ts) — the app-root way to provide the default.
  This **complements** the `Store.withStorage` / `Store.withDefault` façade on `queue-wire-triplet`
  (that façade resolves the store; this export provides it). Together they're a coherent public API.

## 🟡 One owner decision — persistence fidelity (consistency across resources)
The three cutovers diverge on how much they persist:
- **Queue** — the full live event union, rich types (`Cause`, `Exit`, `DateTime`) via `Schema.toCodecJson`.
- **Process** — primitive metadata + optional `result` (user `success` schema).
- **RunResource** — primitive metadata only: `cause` is **stringified**, and the run's **`success`/result
  value is not persisted at all**.

None is wrong, but decide the intended fidelity:
- Is a stringified `cause` enough for run failures, or should they keep the structured `Cause`
  (now cheap — `toCodecJson` round-trips it once that Store-core fix lands)?
- Should a run's `success` value be persisted (RunResource has a `success` slot on its Tag; the store
  currently ignores it)?

If "primitive + lossy is intended for run/process," document it as the deliberate split from the queue.

## 🟢 Polish (non-blocking)
1. **Adopt `Store.withDefault`.** The tap's `bridge.at(scopeKey, contract)` (which propagates
   `StoreScopeNotRegistered`) is exactly `Store.withDefault(scopeKey, contract)` once that façade lands
   — swap it so RunResource stops importing the internal `StoreScopeBridgeTag` (2 files still do).
2. **`Store.ts` will merge-conflict** with `queue-wire-triplet`: this branch adds the `layerDefaultMemory`
   import + `export { layerDefaultMemory }`; that branch adds `withStorage`/`withDefault` in the same
   region. Resolution is trivial — **keep both** (they're complementary). Flagging so the merger expects it.

## Suggested order
1. Merge this branch (it's clean).
2. When the Store-core serialization fix (`toCodecJson`, on `queue-wire-triplet`) lands, revisit the
   fidelity decision above.
3. Re-point the tap at `Store.withDefault` when the façade lands; resolve the `Store.ts` conflict by
   keeping both additions.

**Not merged:** only this review doc is shared to integration; the branch's code is left for the owner.
