# Bug hunt — src-wide (companion to `2026-07-04-beta26-27-audit.md`)

Full pass over `src` for correctness bugs and library-standards violations. Ordered by severity. Every finding
verified against the code. `EXPANDS-DOC` = extends or corrects the beta.26/27 audit; `NEW` = not previously listed.

Baseline: `pnpm lint` clean; `pnpm typecheck` clean on **both** projects (incl. `strict-effect-provide`);
`effect-language-service diagnostics` reports **5 LS-only** `missingEffectContext` in `Process.ts` (see §E).

---

## 🔴 Confirmed runtime bugs

### 1. Queue worker lost-wakeup — items hang until an unrelated enqueue
`src/internal/queueResource.ts:3033` (signal at `2737`). `takeNext` polls the lanes empty, then awaits the mutable
`workerWakeSignal`. An enqueue that runs `Deferred.succeed(old)` + swaps in a fresh Deferred in the window between
the poll and the await leaves the worker parked on the **new** (never-completed) Deferred. With `concurrency: 1`
(or whenever the signal lands in every idle worker's poll→await gap) an offered item is never picked up until the
next unrelated enqueue wakes a worker. Classic condition-variable lost wakeup. **Core engine — affects every
queue.** `NEW`

### 2. `Process.Tag` schedule key baked from sorted-array index → duplicate concurrent instances
`src/Process.ts:683-691,869`. `entryKeyFrom()` derives the entry key from its position in the `startAt`-sorted
array. Inserting an earlier entry shifts every later entry's key; `runningByEntry.has(newKey)` is now false, so
reconcile spawns a **second** concurrent instance of an already-running window while the original (old key) is
never interrupted → permanent duplicate execution. `NEW`

### 3. `Process.Tag` closure refs never reset → process never runs again after stop→start
`src/Process.ts:707-709,779-784,866`. `completedEntries` / `runningByEntry` / `pendingStarts` are closure
`MutableRef`s created once in `createProcess` and never reset; each instance's `ensuring` marks its key completed
**even on interrupt**. `stop()` interrupts the supervisor → keys land in `completedEntries` → `start()` forks a
fresh supervisor → reconcile treats still-valid entries as "completed" and skips them. An always-armed process is
dead after one stop→start cycle — contradicting the documented idempotent lifecycle. `NEW`

> #2 and #3 live in the new supervisor-as-resource machinery (the in-flight `Process` toolkit work), not the
> layer-merge migration. Flagged because they're real, but line numbers will move under active editing.

---

## 🔴 Policy — unapproved dynamic runtime imports

### 4. `Resource.ts` dynamic import papers over a real cycle
`src/Resource.ts:2021` — `Effect.promise(() => import("./internal/nodeStatusResource"))`. `EXPANDS-DOC` (audit §A#1).
Verified: `internal/nodeStatusResource.ts:23` does `import * as Resource from "../Resource"` and needs the
**tag-building primitives** (`Tag`/`effect`/`stream`/`groupSym`/`specSym`) — a genuine load-time cycle the `import()`
defers. **Correction to the audit:** the fix is *not* "extract the schemas" — those primitives must move to a leaf
module both files import statically.

### 5. `laneStoreFactory` dynamic import is a code-split, not a cycle
`src/internal/laneStoreFactory.ts:41` — `import("./levelLaneStoreScheduled.js")`. `EXPANDS-DOC` (audit §A#2).
Verified no back-import → a static `import { makeLevelLaneStoreScheduled }` is trivially safe. Still needs sign-off
under the no-unapproved-dynamic-import rule.

> **Audit §B correction:** the missing `.js` on the `Resource.ts` specifier is **not** a live break —
> `moduleResolution: "Bundler"` (tsconfig.json:9) makes extensionless correct; it's `laneStoreFactory`'s `.js` that's
> the odd one out. Only bites a consumer who flips to NodeNext-strict.

---

## 🟡 Correctness

| # | file:line | defect | failure scenario |
|---|-----------|--------|------------------|
| 6 | `internal/queueResource.ts:2864-2867` | dedup key check-then-insert spans `yield*` (not atomic) | two concurrent `add`s with the same key both pass `HashSet.has` → item processed twice. Fix: single `Ref.modify`. |
| 7 | `internal/queueResource.ts:1877` | durable `maxAttempts = attempts+1` vs in-memory `attempts−1` total tries | `attempts:3` retries 3× in memory, 4× when `persist` on — one extra attempt, diverges from docs |
| 8 | `internal/queueResource.ts:3206` (finalize `2255`) | rate-limit-delayed item counted in neither `totalPending` nor `inFlightRef` | `shutdown` while item sits in `rateLimitAwait` → `ShutdownComplete` fires, then item processes *after* phase="off"; also under-reports `size`/`status` |
| 9 | `internal/queueResource.ts:3188-3200` | `rateLimit.onExceeded:"fail"` records "dropped" + releases key but never re-enqueues | rate-limited item silently discarded; no error reaches enqueuer — data loss |
| 10 | `internal/queueResource.ts:2743-2746` (await `3400`) | `drainWakeSignal` same succeed-then-swap lost-wakeup as #1 | `Drained`/`onDrained` refill missed → `refill.onDrained` queue stalls |
| 11 | `storage/sqlite/durableQueue.ts:79,128` | `decodeUnknownSync`/`encodeSync` throw → Effect **defect**; `mapError(fail)` maps only E | one corrupt/legacy `payload_json` row → `take` dies on every poll, queue wedges permanently instead of `DurableQueueError` (main codec wraps in `Effect.try` — this path doesn't) |
| 12 | `storage/sqlite/historyStore.ts:54,92` | sync codec throws become defects; `Effect.catch` recovers only E | one malformed `json` row → `read` dies (never logs, never returns `[]`) despite "logged, not thrown" promise |
| 13 | `storage/redis/service.ts:127-142,261` | `commitRecords` rewrites **every** record sequentially, no rollback | mid-loop network blip → partial commit, violates documented memory-adapter parity; also O(all-records) writes/tx |
| 14 | `Process.ts:907-910` (`internal/processSchedule.ts:160-188`) | reconcile reads `entries` before acquiring the `changed` Deferred — lost-wakeup window | a mutation landing in that gap is neither seen nor wakes the loop until the *next* mutation |
| 15 | `Process.ts:831-895` | reconcile interrupts `pendingStarts` but never `runningByEntry` on removed entries | `clear()`/`set([])` on an open-ended window → instance polls forever; `status.armed:false` while effect still ticks |
| 16 | `Process.ts:2178-2182` | `start` reads→forks→sets `fiberRef` non-atomically despite "idempotent" | two concurrent `start` calls both fork the driver; first fiber orphaned (leak) |
| 17 | `store/log.ts:248-252` vs `304-305` | `after`/`before` mean both time-cursor (`parseCursorMillis`) *and* lexical `entryId` keyset | a numeric/date-parseable `entryId` gets misapplied as a time window (and vice-versa); works only because entryIds are assumed non-parseable |
| 18 | `Resource.ts:2839` | `clientInstances` forwards a `ref` field as raw RPC `Stream`, cast to `WireServiceOf` — never wrapped via `clientSubscribable` (unlike `buildClientService:2722`) | consumer of a served instances-tag with a `ref` field does `.get`/`.changes` on a `Stream` → `TypeError`. Latent (no in-repo caller) but public export |

---

## 🟢 Casts (real type holes, runtime-safe today)

- `internal/customQueueResource.ts:330-339` — `castProjection`: custom-queue `Record<string,number>` sizes cast to
  fixed `{high,normal,low}` `QueueStatus`; genuine shape mismatch, safe only because the engine treats status
  opaquely. `NEW`
- `Process.ts:1721,1730` — `value as ScheduleMode|undefined` / `as Schema.Top|undefined`: runtime-safe (slots only
  written by `schedule()`/`result()`), rule-break only. `EXPANDS-DOC`
- `web/data.ts:534,538` / `widgets.tsx:225-234` — `kindOf`-gated tag dispatch casts; a `kindOf` miss mistypes the
  tag. `NEW`
- `storage/redis/codec.ts:114` — `as Record<string,unknown>` after an inline guard where `isRecord` would narrow.
- `storage/redis/service.ts:273` — whole `transaction` body `as Effect.Effect<…>`, double-erases error/req union.
- `internal/levelLaneStoreScheduled.ts:46,141` — `state as WeightedState` on `unknown`, no runtime guard.

---

## 🟢 Rule-breaks / naming / dead-code

- **Raw `Error` instead of `Data.TaggedError`** (repo rule; several files' own headers state it): `Resource.ts:2004,2493`;
  `Process.ts:1594,1624`; `internal/processSchedule.ts:321,338`; `internal/queueResource.ts:1413,3384`;
  `internal/levelLaneStoreScheduled.ts:35,60`; `internal/customQueueResource.ts:522`.
- **UPPER_SNAKE value consts** (values must be camelCase): `Resource.ts:2172` (`INSTANCE_KEY_HEADER`),
  `internal/nodeStatusResource.ts:30,33` (`HOST_STATUS_KEY`/`STATUS_INTERVAL`), `disarmedIdleSleep.ts:20-42`.
- `ApiUsageSchema.ts:60,65` — public `ApiUsageMetrics`/`ApiUsageSnapshot` as schema-derived `typeof x.Type` aliases,
  not explicit `export interface` (Telemetry.ts does it right). `NEW`
- `ApiMetrics.ts:178-186` — public `layerFor` typed `Context.ServiceClass<any, ClientId, any>`, undocumented, extra
  generics do nothing at runtime. `NEW`
- `storage/sqlite/service.ts:376-415` — `update`/`delete` loop `INSERT OR REPLACE`/`DELETE` without
  `sql.withTransaction`; non-atomic vs memory-adapter parity, N+1 round-trips. `NEW`
- `store/runResource.ts:673-681` — `factWindowOpts` is a byte-for-byte duplicate of `windowOpts`
  (`internal/store/helpers.ts:116`) it already imports — SSOT violation. `NEW`
- `Polling.ts:151,164-165` — `jittered` clamps ms≥0 but never bounds `jitter` above 1 → `jitter:2` gives
  `sleep(0)` busy-loop between ticks. `NEW`
- `web/debug-console.tsx:95` — `patchConsole()` runs as a render side-effect (not `useEffect`) and never restores
  `console.*` → permanent global monkeypatch, no teardown. `NEW`
- `disarmedIdleSleep.ts:49-85` — the entire disarmed-idle-sleep policy is exported + tested but **never wired** into
  the supervisor (`supervisedCore` blocks on `schedule.changed`, never sleeps a disarmed poll). Orphaned. `NEW`
- `internal/processSchedule.ts:135-146` — `reconcile` drops id-less entries entirely; docstring "matched by
  reference only" is false → `ReconcileResult` under-reports whenever nameless windows are used. `NEW`
- `internal/queueResource.ts:2934,2807-2814` — durable re-inject (`store.offer`) omits `attempts`; re-injecting a
  mid-retry entry into a `persist` queue resets its retry budget to zero. `NEW`
- `Resource.ts:2085` — `mergeLayers` `reduce` has no seed → throws on `[]` (guarded by non-empty tuple type only).
- `storage/sqlite/index.ts:26-29` — module doc claims `selectRuntimeRecords` delegation, but `service.ts`
  SQL-compiles predicates (`querySql`) and never calls it; two predicate impls kept in lockstep by hand, no test
  anchor. `NEW`
- `web/cache.ts:2`, `web/debug-console.tsx:2` — `@module examples/web-dashboard/…` wrong path (shipped lib modules
  mislabeled as examples). `NEW`
- `ProcessRuntime.ts` / `ProcessContract.ts` — empty (0-line) mid-migration scaffolding, export nothing. `NEW`

---

## 🟡/🟢 E. LS-only strict-context (typecheck passes, LS flags)

`Process.ts:407,448,451,454,456` — 5 `missingEffectContext` in the `provideStepLayers`/`provideWithLayer` overload
machinery (polling/schedule layer merge, AGENTS.md invariant #2). tsgo — including `strict-effect-provide` — passes;
only the Effect LS CLI flags it (the editor-only class the CLI exists to surface). Type-soundness gap in the
overload impl body, not a runtime hazard. Adjacent to the in-flight layer-merge migration.

---

## Suggested fix order

1. **#1 queue worker lost-wakeup** — core engine, silent stalls, everyone hits it. Fix the succeed-then-swap
   Deferred pattern (capture the wait handle before re-checking, or use a proper `Queue`/`Signal`). Same pattern
   fixes **#10** (drain) and is adjacent to **#14** (supervisor).
2. **#11 / #12 durable+history sync-codec defects** — one bad row wedges a durable queue / kills history reads;
   wrap the sync codecs in `Effect.try` → `DurableQueueError` like the main codec already does.
3. **#4 / #5 dynamic imports** — revert both to static (extract the tag primitives to a leaf for #4).
4. **#2 / #3 Process.Tag schedule bugs** — coordinate with the in-flight migration (yours); they're real but the
   file is moving.
5. **#6–#10, #13–#18** — the remaining races / data-loss / atomicity issues.
6. Rule-breaks (raw `Error` → `Data.TaggedError`, naming, casts) as a mechanical sweep once the above land.
