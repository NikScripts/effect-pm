# Effect v4 feature scout (overboard edition)

This document catalogs Effect v4 features we can leverage in `@nikscripts/effect-pm`, then maps each feature to concrete use-cases in this codebase.

Goal: identify a *wide* opportunity surface first, then selectively implement.

---

## Scope and sources used

This pass combines:

- Effect v4 package metadata and module exports from local install:
  - `node_modules/effect/package.json`
  - `node_modules/effect/dist/index.d.ts`
  - `node_modules/effect/src/Effect.ts` (for `Effect.fn`, tracing/logging/retry APIs)
- Effect v4 docs and source references:
  - [Effect v4 beta release notes](https://effect.website/blog/releases/effect/40-beta/)
  - [Runtime docs](https://effect.website/docs/runtime/)
  - [Scope docs](https://effect.website/docs/resource-management/scope/)
  - [Layer memoization docs](https://www.effect.website/docs/requirements-management/layer-memoization/)
  - [TestClock docs](https://www.effect.website/docs/testing/testclock/)
  - [Retry docs](https://effect.website/docs/error-management/retrying/)
  - [Built-in schedules](https://effect.website/docs/scheduling/built-in-schedules/)
  - [Tracing docs](https://effect.website/docs/observability/tracing/)
  - [Logging docs](https://www.effect.website/docs/observability/logging/)
  - [Queue docs](https://effect.website/docs/concurrency/queue/)
  - [PubSub docs](https://effect.website/docs/concurrency/pubsub/)
  - [Request batching docs](https://effect.website/docs/batching/)

Codebase surfaces reviewed:

- Runtime core: `src/Process.ts`, `src/ProcessSchedule.ts`, `src/Polling.ts`, `src/ProcessGroup.ts`
- Control plane: `src/ControlService.ts`, `src/cli.ts`
- Work dispatch: `src/QueueResource.ts`, `src/RunResource.ts`
- API/resource helpers: `src/HttpApiResource.ts`, `src/HttpClientRunGate.ts`
- Examples/docs/tests across `examples/`, `docs/`, `test/`

---

## Quick current-state snapshot

We already use Effect well in these areas:

- Structured effects/generators (`Effect.gen`)
- Dependency injection (`Context`, `Layer`)
- scoped lifecycle (`Effect.scoped`, `Effect.acquireRelease`, `forkChild`)
- deterministic time tests (`TestClock`)
- typed optionality/errors (`Option`, `Data.TaggedError`)

The biggest “step-up” areas are:

1. function-level ergonomics and tracing (`Effect.fn`)
2. observability primitives (spans, structured log annotations)
3. policy combinators (retry/timeout/schedule/rate-limit)
4. richer runtime state primitives (`SubscriptionRef`, `ScopedRef`, `Reloadable`)
5. event/stream architecture (`Stream`, `PubSub`, request batching/caching)

---

## Full-surface coverage commitment

This scout is **not** only about "new shiny" features.

For planning purposes, we cover the full Effect v4 top-level namespace surface and classify each feature area as:

- **Use now** (high-value for this package)
- **Use later** (valuable, but not needed immediately)
- **Probably out-of-scope** (good Effect feature, low fit for this package today)

The rest of this document focuses on use-cases; this section guarantees we are considering the whole toolbox.

---

## Full namespace capability map (Effect v4)

Source: `node_modules/effect/dist/index.d.ts` (`export * as ...` modules).

## 1) Core runtime, effects, and dependency system

`Effect`, `Layer`, `Context`, `Scope`, `Runtime`, `ManagedRuntime`, `Exit`, `Cause`, `Deferred`, `Clock`, `Duration`, `Schedule`, `Scheduler`, `Fiber`, `FiberHandle`, `FiberMap`, `FiberSet`, `Logger`, `LogLevel`, `Metric`, `Tracer`, `ExecutionPlan`

**Status for effect-pm:** mostly **Use now**, with `Metric` / deeper tracing as **Use later**.

## 2) Concurrency, queues, synchronization, and state refs

`Queue`, `PubSub`, `Semaphore`, `PartitionedSemaphore`, `Latch`, `Ref`, `MutableRef`, `SynchronizedRef`, `SubscriptionRef`, `Pool`, `ScopedRef`, `RcRef`, `RcMap`

**Status:** `Ref`/`Queue`/`Semaphore` are **Use now**; `SubscriptionRef`, `ScopedRef`, `Pool`, `Rc*` are **Use later**.

## 3) STM / transactional structures

`TxRef`, `TxQueue`, `TxPubSub`, `TxChunk`, `TxDeferred`, `TxHashMap`, `TxHashSet`, `TxPriorityQueue`, `TxReentrantLock`, `TxSemaphore`, `TxSubscriptionRef`

**Status:** mostly **Use later** (or **out-of-scope now**) unless we need stronger transactional invariants in schedule internals.

## 4) Streaming and channel pipelines

`Stream`, `Sink`, `Channel`, `ChannelSchema`, `Pull`, `Take`

**Status:** **Use later** (high potential for schedule sync/evented control plane).

## 5) Request/caching/resource utilities

`Request`, `RequestResolver`, `Cache`, `ScopedCache`, `Resource`, `Reloadable` (via module export), `LayerMap`

**Status:** `Cache`/`RequestResolver` mostly **Use later**; strong candidates for schedule-source sync and de-duplication.

## 6) Configuration and secure values

`Config`, `ConfigProvider`, `Redacted`, `Redactable`

**Status:** **Use now** in CLI/control/runtime policy config; security pieces are **Use now** for secret-bearing integrations.

## 7) Schema and typed data transformation stack

`Schema`, `SchemaAST`, `SchemaGetter`, `SchemaIssue`, `SchemaParser`, `SchemaRepresentation`, `SchemaTransformation`, `SchemaUtils`, `JsonSchema`

**Status:** core `Schema` is **Use now** for boundaries (`ControlService`, CLI); deep schema internals are **Use later**.

## 8) Error/data modeling and matching

`Data`, `Match`, `Filter`, `Result`, `Either`-style APIs via modules, `Predicate`, `Order`, `Ordering`, `Equivalence`, `Equal`, `Formatter`, `ErrorReporter`, `PlatformError`

**Status:** `Data`/`Match`/`Filter` are **Use now**; others are **Use later** as needed.

## 9) Collections and utility modules

`Array`, `Chunk`, `HashMap`, `HashSet`, `MutableHashMap`, `MutableHashSet`, `MutableList`, `Record`, `Struct`, `Tuple`, `Option`, `NonEmptyIterable`, `Iterable`, `Graph`, `Trie`, `Combiner`, `Reducer`, `Differ`, `References`, `PrimaryKey`

**Status:** mostly **Use now** or **Use later** depending on local complexity.

## 10) Primitive data and type-level helpers

`String`, `Number`, `Boolean`, `BigInt`, `BigDecimal`, `Symbol`, `RegExp`, `DateTime`, `Encoding`, `JsonPatch`, `JsonPointer`, `Path`, `Types`, `Unify`, `UndefinedOr`, `HKT`, `Newtype`, `Brand`, `Inspectable`, `Hash`

**Status:** mostly **Use later** / selective **Use now**.

## 11) Environment / platform-like services

`Console`, `FileSystem`, `Random`, `Stdio`, `Terminal`

**Status:** `Console` is **Use now**; others are **Use later** unless examples/CLI expand.

## 12) Functional foundation modules

`Function`, `Pipeable`, `Effectable`, `Utils`, `Absurd`-style helpers exported through `Function` (`pipe`, `flow`, etc.)

**Status:** **Use now**.

---

## Unstable module surface (explicitly tracked)

From package exports, we also track unstable families for future architecture:

`unstable/cli`, `unstable/cluster`, `unstable/devtools`, `unstable/encoding`, `unstable/eventlog`, `unstable/http`, `unstable/httpapi`, `unstable/observability`, `unstable/persistence`, `unstable/process`, `unstable/reactivity`, `unstable/rpc`, `unstable/schema`, `unstable/socket`, `unstable/sql`, `unstable/workflow`, `unstable/workers`

**Policy:** evaluate intentionally behind clear "experimental" boundaries.

---

## Feature inventory + repo use-cases

## A) Function authoring, ergonomics, and API clarity

### 1) `Effect.fn` (and `Effect.fn.Return`)
- **What it is:** typed, named effectful function builder.
- **Use-cases in repo:**
  - `src/Process.ts`: extract reusable effectful operations (`spawnEntryInstance`, `reconcileSchedules`, startup controls wiring) into named `Effect.fn` units for readability and trace names.
  - `src/ControlService.ts`: command handlers (`start`, `stop`, `status`) as named functions with predictable stack traces.
  - `src/cli.ts`: response decoding/formatting pipelines as typed effectful helpers.
  - examples: demonstrate “library-quality style” in `examples/schedule-control-db-sync.ts`.
- **Why high value:** better inference and cleaner abstraction boundaries without ad-hoc `Effect.gen` nesting.

### 2) `Match` module
- **What it is:** composable pattern matching with exhaustiveness.
- **Use-cases:**
  - `src/ControlService.ts`: replace switch+if branching with `Match` for command routing.
  - `src/ProcessGroup.ts`: normalize status transitions and error branching.
- **Why:** reduce branch complexity and improve maintainability as commands grow.

### 3) `Struct` / `Record` functional transforms
- **Use-cases:**
  - `src/cli.ts`: decoding and shaping response payloads.
  - `src/ProcessGroup.ts`: status object assembly and transformations.

---

## B) Reliability, retries, and execution policies

### 4) `Effect.retry` / `Effect.retryOrElse` + `Schedule`
- **Use-cases:**
  - `src/cli.ts` `postCommand`: transient network retry with bounded exponential backoff.
  - `src/ControlService.ts`: optional retries for non-idempotent external calls (if added later).
  - DB-sync examples and future schedule sync worker.
- **Why:** stronger operational reliability under transient failures.

### 5) `Effect.timeout`, `timeoutFail`, `raceFirst`
- **Use-cases:**
  - `src/ControlService.ts`: prevent stuck control operations.
  - `src/cli.ts`: user-facing latency guarantees.
  - `src/Process.ts`: bounded waits around optional external schedule initialization paths.

### 6) `Schedule` combinators (`exponential`, `jittered`, `recurs`, `union`, `intersect`)
- **Use-cases:**
  - polling presets in `src/Polling.ts`
  - DB schedule resync cadence in examples and future production guide
  - release scripts/testing loops where deterministic retry policies help.

### 7) `RateLimiter` module
- **Use-cases:**
  - replace/customize portions of `src/RunResource.ts` and `src/QueueResource.ts` throttling logic.
  - optional per-process schedule update control path (if schedule sync gets heavy).
- **Why:** mature, composable policy instead of home-grown limiter logic.

---

## C) Concurrency and runtime orchestration primitives

### 8) `FiberSet` / `FiberMap`
- **Use-cases:**
  - `src/Process.ts`: replace some manual `Map<string, Fiber<...>>` bookkeeping for pending/running entry fibers.
  - `src/ProcessGroup.ts`: process fiber tracking and cleanup.
- **Why:** less bespoke lifecycle management code.

### 9) `Deferred` as richer orchestration primitive
- **Use-cases:**
  - already used in `ProcessSchedule`; can be extended to lifecycle milestones (driver started, initial schedule applied, etc.).

### 10) `PubSub` + `Queue`
- **Use-cases:**
  - future control event stream in `src/ControlService.ts` (audit trail / evented CLI updates).
  - schedule mutation event bus for observability and external integrations.

### 11) `SubscriptionRef`
- **Use-cases:**
  - `src/ProcessSchedule.ts`: represent schedule state + change stream together.
  - reduce manual `Ref + Deferred` wiring for `changed`.

### 12) `SynchronizedRef`
- **Use-cases:**
  - atomic schedule update + normalization + diff calculation in one mutation step.

### 13) STM family (`TxRef`, `TxMap`, `TxQueue`, etc.)
- **Use-cases (advanced):**
  - if schedule operations evolve into multi-structure atomic updates (entries + pending + running + metrics), STM can make consistency explicit.
- **Risk:** higher complexity; only worth it for truly transactional needs.

---

## D) Resource management and dependency lifecycle

### 14) `Layer.memoize`
- **Use-cases:**
  - avoid duplicate expensive layer builds in example compositions and future app templates.

### 15) `Reloadable`
- **Use-cases:**
  - dynamic schedule providers (refresh from DB/config without full process restart).
  - hot-swappable policy layers for polling/schedule strategies.

### 16) `ScopedRef` / `Resource`
- **Use-cases:**
  - atomic swap of schedule provider resources while preserving cleanup.
  - service reload scenarios for HTTP clients in `HttpApiResource` patterns.

### 17) `Pool`
- **Use-cases:**
  - if control plane or schedule sync adds DB/HTTP heavy operations requiring managed connection pools.

### 18) `ManagedRuntime`
- **Use-cases:**
  - long-running CLI/daemon entrypoints that need explicit runtime lifecycle/disposal.
  - advanced integration tests running many scoped programs.

---

## E) Observability and diagnostics

### 19) `Effect.withSpan` / `withSpanScoped`
- **Use-cases:**
  - `src/Process.ts`: span each run instance and reconciliation cycle.
  - `src/ProcessGroup.ts`: span `start`/`stop` orchestration.
  - `src/ControlService.ts`: span each incoming command.

### 20) `Effect.withLogSpan`
- **Use-cases:**
  - wrap each process tick body so logs automatically carry duration context.

### 21) `Effect.annotateLogs` / `annotateLogsScoped`
- **Use-cases:**
  - annotate with `processName`, `scheduleId`, `entryCount`, `command`, `queueName`.
  - dramatically better grepability and observability in production logs.

### 22) `Metric` / `Tracer`
- **Use-cases:**
  - expose counters for ticks, skipped ticks, schedule mutations, command latencies.
  - optional OpenTelemetry integration guidance in docs.

### 23) Runtime flags (`RuntimeFlags`)
- **Use-cases:**
  - controlled enabling of runtime metrics / op supervision for staging diagnostics.

---

## F) Config, security, and operational robustness

### 24) `Config` + `ConfigProvider`
- **Use-cases:**
  - migrate ad-hoc env reads and numeric defaults in examples/CLI/control into typed config.
  - centralize ports, polling defaults, timeouts, fallback policies.

### 25) `Redacted` / `Config.redacted`
- **Use-cases:**
  - secrets in DB/HTTP config for examples and production docs.
  - avoid accidental secret leaks in logs/errors.

### 26) `Secret` / `Redactable` (if adopted)
- **Use-cases:**
  - safely carry API tokens and credentials through runtime layers.

---

## G) Data validation and error modeling

### 27) `Schema` decode/encode boundaries
- **Use-cases:**
  - `src/ControlService.ts`: strict decode for control request body.
  - `src/cli.ts`: strict decode for server responses.
  - schedule sync examples: schema for DB row -> entry.

### 28) `Data.TaggedError` expansion
- **Use-cases:**
  - command and schedule mutation error taxonomy in `ControlService` and `ProcessSchedule`.
  - more precise CLI errors and test assertions.

### 29) `Cause` tooling (`sandbox`, `pretty`, reason filtering)
- **Use-cases:**
  - richer failure diagnostics around process execution and queue fork handlers.

### 30) `Exit`-driven policies
- **Use-cases:**
  - nuanced post-run behaviors (record and route completed/failed/interrupted paths) with explicit policy helpers.

---

## H) Streams, batching, and caching (future-facing but high potential)

### 31) `Stream` / `Sink` / `Channel`
- **Use-cases:**
  - represent schedule updates as a stream pipeline (source -> transform -> apply controls).
  - streamed control status updates (future CLI watch mode).

### 32) `Cache` / `ScopedCache`
- **Use-cases:**
  - cache expensive schedule source fetches or transformed plans.
  - de-duplicate frequent identical status calls in control surfaces.

### 33) `Request` / `RequestResolver` batching
- **Use-cases:**
  - batched DB schedule row lookup / metadata enrichment in sync loops.

### 34) `RcMap` / `RcRef`
- **Use-cases (advanced):**
  - reference-counted shared runtime objects for long-lived multi-process scenarios.

---

## I) Testing and deterministic simulation

### 35) `TestClock` (already strong, keep doubling down)
- **Use-cases:**
  - extend matrix for schedule mutation semantics (`set/add/clear` from all control surfaces).

### 36) test services beyond clock (random/config/runtime where useful)
- **Use-cases:**
  - deterministic tests for retries/backoff/jitter policies and randomized polling strategies.

### 37) Property-based checks with `fast-check` + Effect test style
- **Use-cases:**
  - schedule normalization invariants
  - reconcile/set/clear idempotence and ordering guarantees.

---

## Codebase mapping by file (quick index)

| File | Highest-value Effect features to evaluate |
|------|-------------------------------------------|
| `src/Process.ts` | `Effect.fn`, `withSpan`, `annotateLogs`, `FiberMap/FiberSet`, `SubscriptionRef`, `Schedule` policies |
| `src/ProcessSchedule.ts` | `SubscriptionRef`, `SynchronizedRef`, richer controls + diffing, `Data.TaggedError` |
| `src/Polling.ts` | `Schedule` composition, `RateLimiter`, observability spans |
| `src/ProcessGroup.ts` | `Effect.fn`, spans/log annotations, `FiberSet`, config/timeouts |
| `src/ControlService.ts` | `Schema` decode, `Effect.fn`, retry/timeout policies, tracing/log annotations |
| `src/cli.ts` | retry/timeout, schema decode, structured logging |
| `src/QueueResource.ts` | `RateLimiter`, `FiberSet`, metrics/spans, possible STM for atomic transitions |
| `src/RunResource.ts` | `RateLimiter`, metrics/spans, config-driven policy |
| `src/HttpApiResource.ts` | spans/logging, reloadable clients, config/redacted secrets |
| `examples/*` | `Effect.fn` style examples, config-driven examples, stream/batching patterns, observability recipes |

---

## Prioritized “go-overboard” candidate backlog

## Tier 0 (very high leverage, low risk)

1. Introduce `Effect.fn` for key reusable effectful functions in:
   - `Process`, `ControlService`, `ProcessGroup`.
2. Add spans/log annotations at:
   - process run, schedule reconcile, control command handling.
3. Add retry/timeout policies to CLI/control network paths.
4. Add schema-driven decode to `ControlService` request parsing and CLI response parsing.

## Tier 1 (medium effort, high leverage)

5. Replace schedule state signaling internals with `SubscriptionRef`.
6. Introduce configurable policy defaults via `Config`.
7. Add metrics counters around process/schedule operations.
8. Add `RateLimiter`-backed option path in `RunResource`.

## Tier 2 (advanced / exploratory)

9. Stream-based schedule sync pipeline with optional batching/caching.
10. Reloadable schedule provider layer.
11. STM-based transactional internals if multi-structure consistency pressure increases.
12. RequestResolver/DataLoader-style batching for external schedule metadata fetches.

---

## Suggested next implementation pass (small, concrete)

If we want a strong first “step-up” without overcommitting:

1. `Effect.fn` refactor for 3-5 hotspots (`Process`, `ControlService`, `ProcessGroup`).
2. Add `Effect.withSpan` + `Effect.annotateLogs` in those same hotspots.
3. Add timeout/retry policies for CLI + control transport edges.
4. Add one docs section in `docs/PROCESS-API.md` named “Operational policies” showing recommended retry/timeout defaults.

That gives immediate quality gains while keeping surface area controlled.

---

## Notes on unstable modules

Effect v4 also exports `unstable/*` modules (`workflow`, `eventlog`, `rpc`, etc.).  
These are promising for future manager-scale orchestration, but should be evaluated behind explicit “experimental” boundaries until APIs stabilize.
