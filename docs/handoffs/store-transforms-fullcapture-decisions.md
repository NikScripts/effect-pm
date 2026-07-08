# Store transforms + full-capture + golden queue — locked decisions

Status: **SHIPPED and merged to integration.** All phases landed on `store-storage-refactor` and merged in.
Each phase: no `as`/`any` beyond the existing tree-walk/rebuild idioms, no lazy imports, one field per line;
both tsconfig projects + Effect LSP + full suite green.

## Landed (final state)
- **Transform layer** (§1): `StoreWriteError` + honest `append` typing; `mapEffects` (generic) +
  `catchWriteErrors` (= `mapEffects` + `catchTag(StoreWriteError)`); `swallowWriteErrors`/`Store.write`/
  `guardWrite`/`writePaths` metadata all deleted; `withStorage`/`withDefault` aliases removed. A custom
  write is transformed **exactly once** (the `effects` delegators are flat; the internal append is on the
  raw handle).
- **Full-capture MERGED-a** (§3): single typed outcome event (`Completed`/`Failed`), redundant `Exit` gone.
- **Worker-A** (beyond the original §3): the tag's **`success` schema drives the worker `effect` return
  type** — declaring `success: S` requires the worker to return `Effect<S, …>` and types `Completed.success`,
  `store.completed`, and the analytics; no `success` schema → `void` (unchanged). Cast-free. One TS limit:
  the RPC-facing `events` **stream** types `Completed.success` as `unknown` (`ResourceTag` spec-invariance +
  Effect can't reduce a union's `.Type` through a generic field); the typed `A` lands everywhere else.
- **Golden example** = `QueueResource` three-tier + analytics + typed success.
- **Merge to integration:** conflicts resolved (facets removed, `store/queueResource.ts` deleted, `store.md`
  = the rewrite). Process/run **contract write types aligned to `StoreWriteError`** and `withDefault` →
  `resolveOrDie` (minimal port). **Process/run taps still hand-roll their swallow** (`catchCause` /
  `recordWrite`) — converting them to `catchWriteErrors` is the agents' adoption follow-up; see
  `store-cutover-process.md` / `store-cutover-runresource.md`.

## Naming (locked)
`mapEffects`, `catchWriteErrors`, `StoreWriteError`, `resolve` / `resolveOrDie`. Reads keep `StoreJournalDecodeError`.

## 1. Categorized store errors + transform layer  (replaces Store.write, swallowWriteErrors-metadata, guardWrite)
- **`StoreWriteError`** — a `Data.TaggedError` the storage layer returns on a journal/IO **write** failure.
  The append path maps its journal write failure to `StoreWriteError`. The **encode** step stays `Effect.orDie`
  (a schema mismatch is a bug → defect). Reads keep failing with `StoreJournalDecodeError`. So the error
  *carries* the category — no method needs marking.
- **Honest `append` typing** — surface it: `append` becomes `Effect<void, StoreWriteError>` (not the current
  cast-to-`never` lie). Ripples to append callers; that's correct. `Store.effects` methods then honestly carry
  `StoreWriteError` in `E` on write paths.
- **`Store.mapEffects(effects, transform)`** — a generic combinator: walk every method on the (nested + custom)
  effects object, apply `transform: (effect) => effect` to each returned Effect, re-nest, re-brand. This is the
  extracted, parameterized version of the machinery `swallowWriteErrors` hand-rolled. Types: the transform
  carries a concrete signature and `mapEffects` maps it per method so type-changing transforms (e.g. narrowing
  `E`) flow through precisely; type-preserving ones (span/retry/timed) pass unchanged.
- **`Store.catchWriteErrors`** = one-liner over the primitive:
  `(effects) => mapEffects(effects, Effect.catchTag("StoreWriteError", (e) => Effect.logWarning("store write failed", e)))`.
  A no-op `catchTag` on reads; on writes it logs + swallows → narrows `StoreWriteError` out of `E`. Defects and
  read/other errors propagate untouched.
- **DELETE:** the `Store.write` idea (never built), `swallowWriteErrors`'s `writePaths`/metadata write-detection,
  and the queue engine's manual `guardWrite`. The engine uses `catchWriteErrors(Store.effects(...))`; done.
- Keep the `StoreEffectsVariance`/`TypeId` brand (it constrains `mapEffects`/`catchWriteErrors` inputs).

## 2. Remove the deprecated aliases
Delete `withStorage` / `withDefault`. All in-repo callers already use `resolve` / `resolveOrDie`. (Other agents
migrate their own callers on their branches — no aliases, per the no-deprecation rule.)

## 3. Full-capture — MERGED (a)
The worker's typed result is recorded exactly once (SSOT), no duplication.
- Type the outcome events from the Tag's `success`/`error` schemas: `Completed { entry, success: A, elapsed }`,
  `Failed { entry, cause: Cause<E>, elapsed }`.
- **Remove the redundant `Exit` event** (`Completed` vs `Failed` already encodes success-vs-failure; a consumer
  can reconstruct `Exit<A,E>` if needed).
- The engine **captures the worker's real success value** (stop discarding to `void`) and threads it into
  `Completed`; `Failed` carries the typed `Cause`.
- Narrow writes become `completed(entry, success, elapsed)` / `failed(entry, cause, elapsed)` with typed payloads.
- Analytics read typed values straight off `Completed`/`Failed` (`slowest`→typed `Completed`, `lastFailure`→typed
  `Failed`). No separate Exit handling.
- Threads the `success`/`error` schemas via `queueEvent(itemSchema, { success: successOf(tag), error: errorOf(tag) })`,
  `makeQueueStoreContract` gains the wire schemas, `builtInQueueStoreContract`/engine/consumer feed them from the tag.
  `CustomQueueResource` (no triplet) falls back to `Void`/`Unknown`.

## 4. Nesting demo (honest, not contorted into the queue)
The queue event log is genuinely flat — do NOT nest it. Demonstrate nesting where natural: a
`sensors: { temperature, humidity }` example in the store guide + a `.test-d` proving the resolved nested handle
types (already covered by `test/store-shape-streams.test-d.ts`; extend/reference it).

## 5. Docs (top-notch)
- Rewrite `docs/guides/store.md`, `docs/guides/store-backing.md`, `docs/guides/queue-resource.md` for the new
  machinery: contracts + shapes (incl. nested), `resolve`/`resolveOrDie`, `Store.effects` (requirement-on-the-
  effects), `mapEffects`/`catchWriteErrors`, the three-tier queue (lean base / engine write-extension / consumer
  read-extension), the 12 analytics reads.
- NEW **migration guide** `docs/guides/store-migration.md`: old tap/bridge → `Store.effects` + `catchWriteErrors`
  + three-tier, with the queue as the worked golden example the other agents copy for process/run.
- Changesets for the whole stack.

## Golden example = QueueResource (already three-tier; this run finishes it)
Lean base (`record`/`events`) + engine write-extension (narrow typed writes via `Store.effects` + `catchWriteErrors`)
+ consumer read-extension (12 analytics reads on `QueueResource.store`). After this run it demonstrates: contracts,
`Store.effects`, the transform layer, categorized errors, full-capture, and the read analytics — the reference.
</content>
