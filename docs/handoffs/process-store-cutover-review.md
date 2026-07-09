# Review — `cursor/process-store-cutover-a3ad` (Process store cutover)

Reviewed 2026-07-07 against `cursor/integration-result-schema-a3ad`. Cross-check with
[`reference` — queue store cutover on `queue-wire-triplet`] and `store-cutover-00-store-core.md`.

## What's good (keep)
- **Declared-dependency resolution, not `serviceOption`.** `makeProcessStoreTap` does `yield*
  StoreScopeBridgeTag` + `bridge.at(scopeKey, contract).pipe(Effect.orDie)` — matches store-core §1.
- **Buffered at the source.** The `recordCompleted/Failed/Interrupted` fns `Queue.offer` into a bounded
  (256) buffer; a drain fiber writes to `store.record`. Because the offer happens at the supervisor
  hot path (not a late `Stream.fromPubSub` fork), **no event burst is dropped** — this is the correct
  shape (the queue learned this the hard way).
- **`layerDefaultMemory` baked into `Process.layer`**, facet (`ProcessExecutionStore`) deleted, engine
  writes store-only, `hasPriorExecutions` on the contract. All aligned.
- **Base event schema is JSON-safe primitives** — `startedAt`/`completedAt`/`durationMs: Schema.Number`,
  `scheduleKey: Schema.NullOr(String)`, `error` defaults to `Schema.String`. This deliberately sidesteps
  the rich-type serialization wall (see below). Smart for the fixed fields.

## 🔴 The real gap — serialization of `result` / `error` (user schemas)
The branch is on the **old store journal codec**, which has two bugs I fixed on `queue-wire-triplet`:
1. **Wrong append direction** — `memoryScope` append does `Schema.decodeUnknownEffect(entry.schema)(payload)`,
   but `record` receives a **decoded** value. Decoding an already-decoded value works for primitives but
   fails for any schema with a real transform.
2. **Hand-rolled `toJsonValue`** instead of Effect's `Schema.toCodecJson` — flattens rich Effect types.

Base process events survive both (all primitives). But `RunCompleted.success` = `Schema.optional(success)`
and `RunFailed.error` = the tag's `error` schema — **these are user-supplied**. A process that declares a
rich `success`/`error` (a `DateTime`, an `Exit`, a `TaggedError` with a transform, a class schema) will
**silently fail to persist / read back**. Tests with plain-struct results pass, so it's latent.

**Fix:** land the Store-core serialization fixes from `queue-wire-triplet` (they're shared journal code,
not queue-specific):
- append encodes the decoded value (not decode),
- journal serializes each row through **`Schema.toCodecJson(entry.schema)`** (Effect's own schema→JSON
  codec — round-trips `DateTime`/`Exit`/`Cause`/`Duration`),
- `toJsonValue` drops `undefined` keys.

With those, the Process store persists rich `success`/`error` for free — and the branch could drop the
"keep it primitive to be safe" constraint if it ever wants richer events.

Key fact behind the fix: `Schema.DateTimeUtc` / `Schema.Exit` / `Schema.Cause` are **identity codecs**
(they encode/decode the live object, not a JSON form), so a naive JSON walk can't persist them —
`Schema.toCodecJson` is Effect's tool that does, exactly as they cross RPC.

## 🟡 Consistency / possible wrong turn — bespoke tap vs. event-union model
The queue persists the **same event union its live `.events` stream carries** (`QueueEvent<T>` with
`DateTime`, `Cause`, `Exit`), via `toCodecJson`. Process instead built a **bespoke `ProcessStoreTap`**
(`recordCompleted/recordFailed/recordInterrupted`) over a **primitive** event schema. Two different
models for the same job. Neither is wrong, but the owner should decide the intended shape:
- If Process events stay simple/primitive → the bespoke tap is fine, but document it as the deliberate
  divergence from the queue's "persist the live union" taxonomy.
- If Process should match the queue → fold the tap into the event-union-persist shape once the codec
  fix lands.

## 🟢 Adopt the new façade (post-dates this branch)
`queue-wire-triplet` just added `Store.withStorage` / `Store.withDefault`. The Process tap's
`bridge.at(scopeKey, contract).pipe(Effect.orDie)` **is** `Store.withDefault(scopeKey, contract)` —
swap it once that lands so Process stops importing the internal `StoreScopeBridgeTag`.

## Suggested order
1. Land the Store-core serialization fixes (encode-direction + `toCodecJson` + undefined-drop) — shared.
2. Re-point the Process tap at `Store.withDefault`.
3. Add a Process store test with a **rich** `success`/`error` schema (proves round-trip), matching the
   queue's `queue-store-persist` test.
4. Owner decision on bespoke-tap vs event-union consistency.

**Not merged:** only this review doc is shared to integration. The branch's code is left for the Process
owner to act on.

---

## Review 2026-07-09 (`integration/storage` after Agent 2 Session 2)

**Status:** Process store cutover is **done** on the integration line. This review's 🔴 gaps are largely resolved.

| Original gap | Current state |
|--------------|---------------|
| Bespoke `ProcessStoreTap` | **Deleted** — engine writes via `store.record` in `Process.ts` (`recordStoreStarted` / `recordStoreFailed` / …) |
| Cast on `builtInProcessStoreContract` | **Removed** — `BuiltInProcessContract` + erased `ProcessEventSchemaOf` (queue pattern) |
| Wrong append direction / hand-rolled JSON | **Fixed** on integration — shared journal codec (`Schema.toCodecJson`); see `store-cutover-00-store-core.md` §5 |
| Rich `success` / `error` round-trip | **Tested** — `test/process-store-engine.test.ts` (memory engine path) + `test/process-store-sqlite.test.ts` (typed `Failed.error` journal codec on SQLite) |
| `Store.withDefault` façade | **Renamed** — `Store.resolve` / `Store.resolveOrDie`; engine uses `Store.effects` + `Store.provideContext` |

**Remaining product gap (not store):** Tag `error` is stamped (`errorSym` on tag) but **not wired into RPC** —
`processSpec` lifecycle methods are `Schema.Void` + `Schema.Never` error. Store path uses typed/fallback
encoding per store-core §5. See Process agent report § RPC error wire blocker.

**Deliberate divergence kept:** Process persists a **primitive execution event union** (not the queue's
full live `QueueEvent` taxonomy). Documented in [`store-cutover-process.md`](./store-cutover-process.md).
