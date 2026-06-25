# @nikscripts/effect-pm

## 0.8.0-beta.1

### Minor Changes

- 24e2eff: Adds signed command authentication for `ControlService` and `ProcessManager`.

  Introduces the public `CommandAuth` module, Ed25519 key records, canonical
  command payload signing, replay protection, strict authenticated `POST /control`
  handling, signed `GetHealth`, admin key generation, and ProcessManager public-key
  enrollment helpers.

- 2a3bdcc: Add protocol request/response envelopes for control transports and expose canonical HTTP `POST /control` routing while preserving REST route aliases.
- 8573f33: Add `ControlTransportRpc`, an Effect RPC adapter for dispatching existing `ControlProtocol` envelopes.
- 850f702: Add headless React dashboard primitives and a styled ops-ui shell for adaptive controls and live logs.

  This introduces browser-safe dashboard target types, `<Controls for={...} />`, `<Logs for={...} />`, `useControlPlaneLogs`, and `ControlPlanePort.logs(...)` with live-following NDJSON log streams plus bounded history parameters. It also adds the `@nikscripts/effect-pm/ops-ui` export with `OperatorDashboard` for a production-oriented dashboard shell, icon-only action buttons, status tables, terminal-style live logs, a styled log toolbar, a persisted resizable dashboard grid layout, shadcn-generated local UI components, bounded scrollable widgets, and persisted dashboard chrome visibility state.

- 1ef3134: Reorganize `src/` into Effect-style flat public modules plus `internal/store` and `internal/manager` helpers. **Breaking:** remove `./ProcessStoreGroupLog` and `./QueueResourceStore` package subpaths; facet services are exported under `store/*` subpaths and composed via `ProcessStore.layer` / `store.Log` / `store.QueueResource`. Public PM modules are now `LogContext`, `LogEntry`, and `Transport`; root `index.ts` no longer re-exports internal log query/watch helpers or `groupChild`. Add `relayWithCaptureLoggerLayer` on `@nikscripts/effect-pm/Logs` for child-runtime wiring.
- 8bac9ce: Ship the package as ESM-only (`"type": "module"`).

  The dual CommonJS + ESM build is gone: there is now a single ESM build, and the `require` export conditions are removed (each `exports` entry is `{ types, default }` pointing at the ESM `.js`). `moduleResolution` moves to `bundler` — transparent to consumers since tsup bundles each entry, so no relative imports escape the package. Consumers must import via ESM (`import`), which the only known consumer already does.

  Bonus: with the whole repo on ESM, the terminal UI (Ink, which is ESM-only via yoga-layout's top-level await) now runs directly under `tsx` instead of needing an esbuild→ESM bundle step.

- 10afd42: Organize public exports into namespace objects while keeping short root import aliases.

  Add namespaces across runtime, storage, control, and process-manager modules (`Query`, `ResourceConfigure`, `DisarmedIdleSleep`, `Cli`, `RuntimeStorage`, `ControlProtocol`, `Process`/`ProcessGroup`/`QueueResource` nested `Errors`/`Schema`, `Logs`, `LogEntry`, `LogContext`, expanded `ProcessManager`). Root exports such as `And`, `configureLayer`, `createCli`, and `Endpoint` remain the same bindings as their namespace members (`Query.And`, `ProcessManager.Endpoint`, etc.).

  New subpaths: `@nikscripts/effect-pm/ResourceConfigure` and `@nikscripts/effect-pm/ControlProtocol`.

  This branch is rebased on `main` (configure + export namespaces only). Prisma / durable storage work lives on `cursor/remove-xor-query-958b`.

- eb4cd7c: Add `LogTransportRpc`, an Effect RPC adapter for live process-manager log streams.
- e4a11e2: Add `pm watch` and `pm logs` operator commands with structured log annotations (`groupId`, `processId`, `queueId`). Child runtimes persist captured log lines to a SQLite-backed `ProcessStore` at `.effect-pm/logs/<group>/logs.sqlite`; `pm logs` queries that history by target (group, process, or queue) with date, cursor, limit, and sort flags.

  Unify operator lifecycle commands: `pm start <target>` and `pm stop <target>` dispatch by resolved identifier (group child launch/stop, process controls, or queue start). Remove `group-start`, `group-stop`, and `queue-start`.

- 5777241: Ship `PrismaRuntimeStorage` as a Prisma-backed `RuntimeStorage` adapter over normalized runtime records.

  The Prisma schema fragment now declares `EffectPmRuntimeRecord` mapped to the `effect_pm_runtime_records` table, with indexed columns stored as scalar fields and runtime JSON blobs serialized into string columns. The adapter expects an injected structural client with an `effectPmRuntimeRecord` delegate. Consumers continue to own Prisma generation, migrations, and client lifecycle.

  Add `effect-pm prisma init` for interactively adding the schema fragment to an existing Prisma project, and verify the adapter with both structural mocks and a generated Prisma SQLite client.

  Add typed `RuntimeStorage` operational errors for durable adapters, mapping Prisma / SQLite driver and decode failures into public storage error tags instead of defects.

  **Breaking:** static ProcessStore facet emitters now surface write failures when a storage layer is present. They still no-op when the facet layer is absent. Use the new pipeable `ProcessStore.catchErrorAndLog(...)` helper for writes that should remain best-effort telemetry.

  **Breaking:** SQLite `layerProcessStore` now surfaces typed acquisition errors. Use `layerProcessStoreOrDie` to keep the previous defect-on-acquisition behavior at application edges.

- be2890c: **`ProcessGroupDuplicateDefinitionError`** — `makeProcessGroup` fails at definition time when process names or queue tag keys are duplicated in the group config.
- b3ff52c: Add `ProcessGroup.localEnvLayer` and `ProcessGroupServiceDefinition.localEnvLayer` to compose child runtime env layers without duplicate queue merges. Export `ProcessGroupServiceLayerProvided` on `ProcessGroup.Service.layer` for accurate requirement typing.

  Add `ProcessManager.groupLocalRuntime` as a one-liner `LocalRuntime` + HTTP control descriptor.

  Fix `ControlRouter.layerFromGroup` to accept groups with bundled endpoint config items.

- fe1404b: **ProcessGroup `startAll`** now runs **`QueueHandle.start`** for every registered queue **before** starting processes (pairs with **`QueueResource` `autoStart: false`**).

  Adds **`TypedProcessGroup.startAll`**, **`TypedQueueControls.start`**, contract capability **`start`** on queues, **`POST /queues/:id/start`** on **ControlService**, and **`RemoteQueueControls.start`** / **`POST …/start`** on **ProcessManager**. Multi-group CLI exposes **`queue-start <target>`** (distinct from **`start`** for processes).

- 773eb5f: **Breaking:** `Process.make` now requires `(id, config)` or `(id, effect, …)`; the single-object form with `name` in config is removed. `ProcessMakeOptions` is the public config type (no `name` field). `Process.providePolling` and `Process.provideSchedule` are removed; pass preset polling/schedule layers positionally or on the config object.
- e4160cc: Replace module/runner endpoint shims with child-only `Endpoint.local(transport, entry)`, pipe child stdout/stderr into `.effect-pm/logs`, and add `pm watch` for live structured logs and `pm logs` for stored history.

  Group `watch` streams structured Effect log entries over the control HTTP API (`/logs/stream`) and replays them through the operator logger layer, replacing file tailing of child stdout/stderr.

- a3b0967: Add ProcessManager endpoint config items, endpoint label selection, status probing, module endpoint launcher support, and local group stop/run-state cleanup.
- 773eb5f: Change `Process.make` default schedule from empty in-memory storage to `ProcessSchedule.alwaysArmed` when both `schedule` and `scheduleLayer` are omitted. Add `ProcessSchedule.empty` for apps that relied on the previous disarmed-until-mutation default — pass `schedule: ProcessSchedule.empty` to restore that behavior.
- f3bcbad: **Breaking — rename `ProcessStoreGroupLog` → `LogStore`.**

  The facet that persists structured log entries for the
  `@nikscripts/effect-pm/Logs` capture/relay pipeline never served a single
  `ProcessGroup.Service`; its bucket id (the `groupId` parameter) is an opaque
  partition supplied by the relay (today the PM log annotation from
  `LogContext`). The previous "GroupLog" naming implied a `ProcessGroup`-scoped
  service and conflicted with the distinct `ProcessGroupStore` facet,
  which actually does serve typed process groups.

  Renamed surface (no compatibility shims):

  - `ProcessStoreGroupLog` → `LogStore` (service tag + class)
  - `ProcessStoreGroupLogApi` → `LogStoreApi`
  - `makeProcessStoreGroupLog` → `makeLogStore`
  - Subpath `@nikscripts/effect-pm/store/GroupLog` → `@nikscripts/effect-pm/store/Log`
  - Service key `@nikscripts/effect-pm/store/groupLog/ProcessStoreGroupLog` → `@nikscripts/effect-pm/store/log/LogStore`
  - `ProcessStoreInterface.GroupLog` → `ProcessStoreInterface.Log` (on the
    transitional `ProcessStore` monolith)
  - Wire event `type: "group.log.entry"` → `type: "log.entry"` and
    `entityType: "group"` → `entityType: "log"`
  - `GroupLogEntryRecordedEvent` → `LogEntryRecordedEvent`
  - `isGroupLogEntryRecorded` → `isLogEntryRecorded`
  - File `src/store/groupLog.ts` → `src/store/log.ts`

  Existing SQLite rows with `type: "group.log.entry"` will not decode under the
  new codec. Drain the durable log store or migrate rows before upgrading.

  The deprecated alias `makeLogStores` is removed.

- e713522: Replace the generic `ProcessStoreRuntime` facet with a per-domain
  **`RunResourceStore`** facet (`@nikscripts/effect-pm/store/RunResource`),
  tailored to `RunResource`. Persistence is unchanged at the storage row level
  (facts and state changes still flow through `RuntimeStorage` + spine), but the
  public vocabulary is now strictly per-domain — there is no shared generic
  fact / ref / state-change envelope in any public API.

  `RunResourceStore` is built via
  `ProcessStore.Service<RunResourceStore>()(...)` — one canonical
  class-style facet with a single `record` + `read` block. The class exposes:

  - Static **per-type** optional emitters:
    `RunResourceStore.recordRunStarted`, `.recordRunCompleted`,
    `.recordRunFailed`, `.recordStateChange`, plus the `recordFactBatch` /
    `recordStateChangeBatch` siblings. All no-op when the facet layer is
    absent and persist when composed. Every static emitter is wrapped by a
    built-in `catchCause + logWarning` inside the builder so observation
    failures never reach the caller's success/error channel.
  - Reads via `Effect.serviceOption(RunResourceStore)` then instance
    methods (`.facts`, `.stateHistory`, `.latestState`, `.runs`, `.byRun`) —
    never static methods on the class.
  - Layer accessors: `RunResourceStore.layerRuntimeStorage` (requires
    `RuntimeStorage`) and `RunResourceStore.layer` (in-memory).
  - Type accessors via declaration merging: `RunResourceStore.Type`
    (full service shape, for typing mocks / `Layer.succeed`) and
    `RunResourceStore.EmitType` (record-section emit shape).

  **Wire event types:** `run-resource.fact.recorded`,
  `run-resource.state.changed`. The previous generic `runtime.fact.recorded` /
  `runtime.state.changed` wire types remain in
  `src/internal/store/factEnvelope.ts` as **internal-only** plumbing for
  `QueueResourceStore`.

  **Breaking changes:**

  - Remove the public `ProcessStoreRuntime` facet (`@nikscripts/effect-pm/store/Runtime`).
    Use `RunResourceStore` (`@nikscripts/effect-pm/store/RunResource`)
    instead. Read via `Effect.serviceOption(RunResourceStore)` and
    service instance methods.
  - Remove the generic `RuntimeFact`, `RuntimeRef`, `RuntimeStateBase`,
    `RuntimeStateChange`, `RuntimeFactQuery`, `RuntimeStateHistoryQuery`,
    `RuntimeFactRecordedEvent`, `RuntimeStateChangedEvent` types from the
    public API. Use the concrete `RunResourceRef`, `RunResourceFact`,
    `RunResourceStateBase`, `RunResourceStateChange`, `RunResourceFactQuery`,
    `RunResourceStateHistoryQuery`, `RunResourceFactRecordedEvent`,
    `RunResourceStateChangedEvent` types exported from
    `@nikscripts/effect-pm/store/RunResource`. New domains must publish their
    own concrete types — see [`docs/STORAGE.md`](../docs/STORAGE.md).
  - Remove `ProcessStore.runtime`, `ProcessStore.runResource`, and
    `RuntimeObserver` / `RuntimeObserver.layerFromProcessStore` /
    `RuntimeObserver.layerListeners` / `RuntimeObserver.publishFact` /
    `RuntimeObserver.publishStateChange`. Emissions now go through the
    per-type static optional emitters on `RunResourceStore`;
    in-process listeners are implemented by providing a custom service typed
    as `RunResourceStore.Type` via `Effect.provideService` /
    `Layer.succeed`. See `RunResource`'s module doc and
    `examples/forms/resource/run-resource-runtime-observer.ts` for the
    fan-out pattern.
  - Remove `persistRuntimeObservation` from the public API. The same
    failure-isolation behavior is now built into every static emitter by the
    `ProcessStore.Service` factory; consumers no longer wire it manually.
  - Remove the public `ProcessStoreRuntimeApi` type alias and
    `RuntimeObservationListener` interface. Use `RunResourceStore.Type`
    instead, and declare the local listener bag shape inline in the consumer
    that needs it.
  - `ProcessStore.layerRuntimeStorage` and `layerProcessStore` now merge the
    `RunResourceStore` facet layer in place of `ProcessStoreRuntime`.
  - The `byTimestampDesc` helper in the internal spine now applies a stable
    event-id tiebreaker for events sharing the same millisecond timestamp,
    removing a long-standing flake in `RunResource` projection tests. This is
    observable only as more deterministic ordering on identical-timestamp
    rows in `facts` / `stateHistory` / `events` query results.

- 50ad1ac: **Identifier-bound storage APIs** for the four facets where it carries
  the most weight, plus a doc-comment polish pass across the storage
  surface. All additive — no breaking changes.

  `ProcessStore.withIdentifier(...)` now decorates these facets with
  `Facet.for(id)` / `Facet.withIdentifier(id)` shortcuts that return an
  identifier-scoped read (and, where natural, write) API. The unbound
  `yield* Facet` shape is unchanged.

  ## Added — `for(id)` bindings

  - `QueueResourceStore.for(queueId)` — `entries(query?)`,
    `entriesByKey(key, query?)`, `lifecycle(query?)`, `dedupeKeys(query?)`.
    All four narrow to the bound `queueId` (and still respect any other
    filters supplied through the bound query).
  - `RunResourceStore.for(resourceId)` — `facts(query?)`,
    `stateHistory(query?)`, `latestState()`, `runs()`, `byRun(runId)`.
  - `ProcessLifecycleStore.for(processId)` — `lifecycle(opts?)`,
    `latest()` (returns `Option<ProcessLifecycleTag>`),
    `recordTransition({ tag, error?, occurredAt?, attributes? })`.
  - `ProcessExecutionStore.for(processId)` — `executions(query?)`,
    `hasPriorExecutions()`, `recordCompleted(input)` /
    `recordFailed(input)` / `recordInterrupted(input)` (each takes
    `Omit<ProcessExecutionFinishInput, "processId">`).

  Each facet gained a matching `IdentifierType` namespace alias for typed
  mocks, and the new `RunResourceScopedFactQuery` /
  `RunResourceScopedStateHistoryQuery` / `ProcessExecutionScopedQuery` /
  `ProcessExecutionScopedFinishInput` types are re-exported from the
  package root.

  ## Tests

  18 new conformance tests covering `for(...)` and `withIdentifier({ id })`
  narrowing, scope isolation, identifier-bound writes, and structural
  `IdentifierType` accessors — including a brand-new
  `test/process-store-process-lifecycle-facet.test.ts` suite. Existing
  test surface (254) is unchanged; total now 272 passing.

  ## Documentation

  `docs/STORAGE.md` adds the **identifier-bound APIs** section (table of
  all built-in `for` facets, an authoring template that delegates to
  shared private read helpers) and a section header listing the three
  builder sections (`record`, `read`, `withIdentifier`).

  Module-header polish across `RuntimeStorage`, `ProcessStore`,
  `ProcessStorage`, `ProcessStoreEvent`, `internal/store/spine.ts`, and
  all six storage facets adds:

  - Field-by-field comments on `RuntimeRecord` and per-method comments on
    `ProcessStoreSpine` / `RuntimeStorageService`.
  - "At-a-glance" tables on `RunResourceStore`,
    `QueueResourceStore` (wire types × indexed columns),
    `ProcessExecutionStore`, `ProcessLifecycleStore`,
    `ProcessGroupStore`, `LogStore`.
  - `@example` blocks on `ProcessStorage.layer` /
    `ProcessStorage.layerRuntimeStorage` and on the `ProcessStore` builder.
  - Reworded `ProcessStoreEvent` module + `AnalyticsEventBase` doc to
    drop the "legacy" framing — these primitives are the current shared
    surface, not transitional ones.

- e0c63cd: Add optional deferred worker fork for priority queues: config **`autoStart`** defaults to **`true`** (unchanged behavior). When **`autoStart`** is **`false`**, **`yield* queue.start`** forks the worker pool and lifecycle hook monitor; enqueue still succeeds and items accumulate until then. **`start`** is idempotent and becomes a no-op after **`shutdown`** (warning logged).
- aa84825: **Breaking:** `QueueHandle`, `QueueResource.Service`, `QueueResource.Tag`, and `QueueResourceConfig` reorder type parameters so **worker/requirements channel `R` is last**. Order is **`T`**, **`E`** (worker item effect failure), **`EEnqueue`** (schema enqueue failures, usually `never` without `itemSchema`), **`R`** (ambient services).

  `QueueEnqueue`-shaped enqueue helpers propagate **`R`**, and `ProcessGroup` exports **`ProcessGroupQueueEnqueueRequirements`** alongside **`ProcessGroupQueueEnqueueError`** so typed **`group.queue(Q).add(…)`** reflects enqueue-time dependencies.

  Bundled-queue composition for **`ProcessGroup.Service.layer`** narrows **`Layer.Layer<Self, …, Provided>`** and uses **`Layer.merge`** for remerging queues so Context subtraction stays honest.

- 006879a: **Queue `rateLimit`** — Effect `RateLimiter` on workers (before concurrency semaphore).

  - `rateLimit` config on `QueueResource` / `Service.configure` (`window`, `limit`, `onExceeded` default `"delay"`)
  - `onRateLimitExceeded` hook and `queue.ratelimit.exceeded` on `QueueResourceStore`
  - `queueRateLimiterLayer` for in-memory limiter; `record: "off"` skips exceeded telemetry

- c741f80: Remove the public `Xor` runtime-record predicate from the `Query` DSL.

  `RuntimeRecordPredicate` now supports comparisons plus `And` / `Or` composition only, keeping future storage adapters aligned with common database predicate primitives.

- 164baf7: Location-transparent resource toolkit: drive processes, queues, and schedules with the same `yield* Tag` code whether they run local or remote.

  The `Resource` foundation is now a first-class, exported surface, with batteries-included resource kinds built on it. A resource is defined as a `.Tag` (a `Context.Service` class) and its runtime is a separately-composed `.layer` — the same consumer code runs unchanged whether the resource is provided locally or reached over RPC; only the layer differs.

  **New / newly-exported:**

  - **`Resource`** (foundation) — `Tag` / `layer` / `server` / `serveHttp` / `client` / `connect` / `connectHttp` / `Host`, plus `serveInstances` / `clientInstances` for multi-instance hosting. Contracts are introspectable via the newly-exported **`specOf`** + **`methodMeta`** (`kind` / `description` / `destructive` / `streaming`) — enough to render a generic dashboard/TUI from any tag.
  - **`ProcessResource`** (`@nikscripts/effect-pm/ProcessContract`) — a managed process as a toolkit resource: `statusNow` / `status` / `schedule` / `logs` reads, `start` / `stop` / `runImmediately` lifecycle, and `setSchedule` / `addSchedule` / `clearSchedule`. Auto-arms and runs immediately with its layer (pass `schedule: ProcessSchedule.empty` to start disarmed).
  - **Toolkit `QueueResource`** (`@nikscripts/effect-pm/QueueContract`) — the priority-queue engine behind a location-transparent contract (control + observation + data-plane, remote-proven over http). The barrel `QueueResource` remains the legacy engine during migration; import the toolkit queue from the subpath.
  - **`ProcessScheduleResource`** (`@nikscripts/effect-pm/ProcessScheduleContract`) — a schedule store as its own resource: full CRUD (`entries` / `get` / `has` / `set` / `add` / `upsert` / `remove` / `removeMany` / `clear`), diff-based `reconcile`, and a `changes` stream.
  - **`Group`** (`@nikscripts/effect-pm/Group`) — `Group.Tag` organizes member tags into a nestable tree (`members` / `isGroup`). Pure organization with no runtime: members can run on the same or different hosts, each resolving its own transport (no central manager).
  - **`HostLogs`** (`@nikscripts/effect-pm/HostLogs`) — runtime-wide log capture + stream.

  **Enhancements:**

  - **`.configure` for toolkit resources** — `QueueResource.configure(tag, patch)` / `ProcessResource.configure(tag, patch)` return a config-patch layer (keyed by the tag id) that folds onto the layer's base config at build, for per-environment overrides (concurrency / rateLimit / …). The successor to the old `.Service(...).configure(...)`.
  - **Process run metrics** — `ProcessSnapshot` / `processStatus` gain `runsStarted` / `runsSucceeded` / `runsFailed` and `lastRunStartedAt` / `lastRunDurationMillis`, counted at the single run boundary so they cover scheduled, polling, and `runImmediately` runs.

  All additive — no existing API is removed or changed; the legacy `Process` / `QueueResource` / `ProcessGroup` / `ControlService` surfaces remain during migration.

- e6cae43: **Redis `RuntimeStorage` adapter** (`@nikscripts/effect-pm/storage/redis`).

  - `RedisRuntimeStorage.layer` / `layerProcessStore` — full `RuntimeStorageService` over a `send(command, …args)` transport.
  - `makeInMemoryRedisSend` for tests without a Redis server.
  - Same query, readonly, and `transaction` semantics as memory and SQLite adapters.

- be2890c: **`RuntimeStorage.transaction`** — atomic read/write scopes on memory, SQLite, and Prisma adapters.

  - New `RuntimeStorageService.transaction(effect)` runs `effect` with a transactional
    `RuntimeStorage` in context; commits on success, rolls back on failure.
  - Conformance tests cover commit and rollback semantics.

- 0ff3793: Add semantic `ProcessStore.QueueResource` helpers for queue entry, lifecycle, and dedupe-key records, and wire `QueueResource` to write indexed runtime records through `ProcessStore` when it is available.

  Move the default in-memory `ProcessStore` backing store onto `RuntimeStorage`, with analytics reads projected from normalized records.

  Remove `QueueResource`'s storage-oriented `persist` and `refill` callbacks in favor of `ProcessStore` storage and queue-bound `onStart` / `onDrained` lifecycle hooks.

  Replace queue `handler`, `onEnqueue`, and `onComplete` callbacks with queue lifecycle envelopes such as `onEnqueued`, `onExit`, `onCompleted`, `onFailed`, and retry lifecycle hooks.

  Add pending-entry queue routing controls: `release`, `drop`, and `deadLetter`, plus corresponding lifecycle hooks.

  Add `releaseEncoded` for schema-backed remote/wire handoff while keeping local decoded `release` available without `itemSchema`.

  Move Prisma storage onto the RuntimeStorage adapter over normalized RuntimeRecord rows.

  Map `RuntimeStorage` write failures into `ProcessStoreWriteError` so semantic ProcessStore APIs can surface duplicate and readonly write errors explicitly.

- 3cfc25a: **Breaking — silo per-domain storage facets onto `RuntimeStorage` directly.**

  Storage facets now own their wire codec end-to-end. Shared infrastructure
  (`internal/store/spine.ts`, `internal/store/helpers.ts`) is type-agnostic;
  each facet builds and decodes its own `RuntimeRecord` rows and pushes
  predicates into `RuntimeStorageQuery` directly.

  ## Removed

  - **`AnalyticsEvent` envelope union** and the central
    `internal/store/codec.ts` decoder. Facets no longer share a wire-event
    vocabulary.
  - **`StoreEventQuery`** — replaced by per-facet query types (e.g.
    `QueueEntryQuery`, `RunResourceFactQuery`, `ProcessExecutionQuery`).
  - Shared Prisma event-row types are no longer re-exported from the package root
    or from `ProcessStoreEvent`.
  - **Prisma row codec exports** (`decodeEventRow`, `encodeEvent`,
    decode errors) — removed from `@nikscripts/effect-pm/prisma` and
    `@nikscripts/effect-pm/storage/prisma`. Prisma now targets the `RuntimeStorage`
    adapter contract and no longer
    exposes a row codec at the package boundary.
  - **Per-facet wire-event narrowing helpers**
    (`isQueueEntryRecordedEvent`, `isQueueLifecycleChangedEvent`,
    `isQueueDedupeKeyChangedEvent`) — only the surviving
    `isLogEntryRecorded` guard remains, now exported from
    `@nikscripts/effect-pm/store/Log`.
  - **Internal plumbing** `src/internal/store/codec.ts` and
    `src/internal/store/factEnvelope.ts`. The `FactEnvelope` /
    `FactEnvelopeStateChange` envelope is gone — each facet writes its own
    payload shape.
  - **Legacy spine shims** (`append`, `appendBatch`, `events`) on the
    internal `ProcessStoreSpine`. Facets call `s.create` / `s.createBatch` /
    `s.read` / `s.upsert` / `s.update` / `s.delete` directly.

  ## Reshaped queue wire types

  The queue facet now exposes per-status concrete fact / change types
  instead of a single `runtime.fact.recorded` envelope:

  - `QueueEntryFact = QueueEntryEnqueuedFact | QueueEntryStartedFact | …`
    (one type per `queue.entry.<status>`).
  - `QueueLifecycleChange = QueueLifecycleStartedChange | …` (one type per
    `queue.lifecycle.<tag>`, including the new `queue.lifecycle.drained`).
  - `QueueDedupeKeyChange = QueueDedupeKeyAddedChange | …`.

  Emit API: a single `recordEntry(fact)` / `recordLifecycle(change)` /
  `recordDedupeKey(change)` (plus `*Batch` variants). The previous
  per-status methods (`entryEnqueued`, `entryStarted`, …) and contextual
  binders (`withQueue`, `withEntry`) are gone.

  Read API:

  - `entries(query?: QueueEntryQuery)` with pushable `queueId`, `entryId`,
    `key`, `batchId`, `releaseId`, `types`, and `opts`.
  - `entriesByKey(key, query?)` for cross-queue key lookups.
  - `lifecycle(query?: QueueLifecycleQuery)` and
    `dedupeKeys(query?: QueueDedupeKeyQuery)` with their own pushable
    predicates.

  ## Per-facet ownership

  - `LogEntryRecordedEvent` and `isLogEntryRecorded` now live in
    `src/store/log.ts` (re-exported via the package root).
  - `ProcessLifecycleChangedEvent` / `ProcessLifecycleTag` now live in
    `src/store/processLifecycle.ts`.
  - `ProcessExecutionCompletedEvent` / `ProcessExecutionStatus` now live in
    `src/store/processExecution.ts`.
  - `RunResourceFactRecordedEvent` / `RunResourceStateChangedEvent` are
    removed (the run-resource facet returns concrete `RunResourceFact[]` /
    `RunResourceStateChange[]` already).
  - `ProcessStoreEvent` now exports only `JsonValue`, `QueryOpts`,
    `AnalyticsEventBase`, and the `ProcessStoreWriteError` channel.

  ## `ProcessStore.record(...)` DX flip

  `ProcessStore.record` now takes an object literal of
  `{ [methodName]: (s) => method }` factories instead of a single
  `(s) => api` factory. Emit method names are read from the object literal
  at module load time, which makes the static optional emitters typed
  without runtime introspection. The internal `stubSpine` is gone.

  ## Read query semantics

  `QueueResourceStore`, `ProcessGroupStore`, and
  `ProcessExecutionStore` now apply `opts.limit` to the **post-
  filter** result whenever the storage query is a strict superset of the
  final projection (e.g. group queries that filter by
  `attributes.groupId`, or `executions({ scheduleKey })`). Previously
  `opts.limit` was pushed to storage first, which could collapse a
  `limit: N` query that targeted a sparse post-filter to zero rows. The
  `before` / `after` time window is still pushed down. A new internal
  helper `windowOpts` is shared across the three facets.

  ## Queue dedupe-key emit

  `QueueResource` now writes `queue.dedupe-key.added` rows when items
  acquire a dedupe key on enqueue or when a previously-extracted batch
  is restored after a failed `releaseEncoded`, and
  `queue.dedupe-key.released` rows on completion, `release`, drop,
  dead-letter, and `clear`. The previously-documented dedupe projection
  (`.dedupeKeys`) is now backed by real data instead of being unwired.

  ## Queue retry hook race fix

  `QueueResource.processItem` now releases the dedupe key (and emits the
  `released` change) BEFORE forking the exit hooks, instead of after.
  Hooks that synchronously call `retry` from inside `onFailed` /
  `onExit` no longer race the main fiber for the `activeKeys` ref, and
  the emitted `dedupe-key.released` always precedes the retry's
  re-enqueue `dedupe-key.added` change.

  ## Queue enqueue → worker race fix

  `QueueResource.enqueueInternal` now records its `entry.enqueued` and
  `dedupe-key.added` changes BEFORE waking the worker (`signalWorkerWake`
  is now the last step). The worker thread shares the dedupe-key seq
  counter with the enqueue path; signalling first allowed the worker to
  process and `release` an item before the matching `added` was built,
  producing out-of-order analytics for the same dedupe-key cycle. The
  internal `activeKeys` ref is updated under the enqueue's gate before
  either record/wake step, so the runtime dedup invariant is unchanged.

  ## Worker route fix

  `QueueResource.drop` and `.deadLetter` now persist the caller-supplied
  `reason` as a top-level field on the resulting `queue.entry.dropped` /
  `queue.entry.dead-lettered` fact, instead of nesting it inside
  `attributes`. Reads through `.entries({ types })` therefore expose the
  typed `reason` field directly.

- d26e7ca: Refactor the SQLite `RuntimeStorage` adapter to use Effect SQL (`effect/unstable/sql`’s `SqlClient` via `@effect/sql-sqlite-node`) instead of calling `better-sqlite3` directly from package code.

  **Breaking:** `SQLiteRuntimeStorage.fromDatabase` is replaced by `fromSqlClient`, which installs the schema as an `Effect` and expects an existing `SqlClient`. `makeRuntimeStorage` / `layerRuntimeStorage` now require an ambient `Scope` (use `Effect.scoped` or `@effect/vitest` `it.live`) so the SQLite client lifetime matches the returned port; they use `Layer.buildWithScope` internally. `SQLiteRuntimeStorageOpenError` and direct `better-sqlite3` / `@effect/sql` 0.51 dependencies are removed from the package surface.

  Duplicate primary key inserts map both `UniqueViolation` and SQLite `ConstraintError` (including `SQLITE_CONSTRAINT_PRIMARYKEY`) to `RuntimeStorageDuplicateRecordError`.

  Persist every `RuntimeRecord` field in SQLite, keep query semantics aligned with `RuntimeStorage.memory` via shared `selectRuntimeRecords` evaluation, and document the adapter in the runtime storage guide alongside conformance and persistence tests.

- 09be964: **Breaking — storage facet read/write API and stack cleanup.**

  - Remove the `ProcessStoreBuilder` entry module. Author facets with
    `ProcessStore.Service`, `ProcessStore.record`, and `ProcessStore.read`
    (see `docs/STORAGE.md`).
  - Facet classes expose **static emitters only** for writes. **No static read
    methods** on facet classes (`executions`, `load`, `facts`, etc.).
  - Reads use `Effect.serviceOption(ProcessStoreX)` and `Option.match` with
    explicit `onNone` / `onSome: (store) => store.<read>(...)`. There is no
    `ProcessStore.withFacet` helper and no stub `missing` read API when the
    layer is absent.
  - Add `ProcessStorage` (`@nikscripts/effect-pm/ProcessStorage`) to compose all
    built-in facet layers (memory and `layerProcessStore` / SQLite).
  - Remove NDJSON/file process store (`ProcessStore.file`, `src/storage/file.ts`,
    `examples/forms/process-store/process-store-events-file-layer.ts`,
    `test/process-store.test.ts`).
  - Remove legacy monolith composite (`src/internal/store/composite.ts`).
  - Consolidate storage documentation into `docs/STORAGE.md` (removed scattered
    storage guide copies).

- be2890c: **Breaking — rename storage facet services to `*Store`.**

  | Before                         | After                   |
  | ------------------------------ | ----------------------- |
  | `ProcessStoreQueueResource`    | `QueueResourceStore`    |
  | `ProcessStoreRunResource`      | `RunResourceStore`      |
  | `ProcessStoreLog`              | `LogStore`              |
  | `ProcessStoreProcessExecution` | `ProcessExecutionStore` |
  | `ProcessStoreProcessLifecycle` | `ProcessLifecycleStore` |
  | `ProcessStoreProcessGroup`     | `ProcessGroupStore`     |

  Context tags and `@nikscripts/effect-pm/store/*` subpaths are unchanged.
  `ProcessStorage.QueueResource` (etc.) remain shorthand property aliases.
  `ProcessStore` is still the facet builder module only.

  No deprecated re-exports of old names.

- c838dd6: Adds public remote terminal session contracts and an Effect RPC group for future
  terminal transports.
- f4e2c13: Add typed process group declarations, contracts, and remote management. Processes and queues can now be registered as canonical class services, `ProcessGroup.make(id, entries)` builds a typed group from a single entries tuple, `ProcessGroup.Service` provides an injectable group, `ControlService` exposes schema-validated group contracts at `GET /contract` plus contract-aligned process/queue REST routes, `ProcessManager.connect` creates a typed remote client for supported process/queue controls, and `ProcessManager.Endpoint` provides that remote client as an injectable Effect service.

  `ProcessGroup.remoteLayer` can now provide a group service from a `ProcessManager.Endpoint`. Group service/control errors are widened through `ProcessGroupControlError`, including the new `ProcessGroupRemoteControlError` and `UnsupportedRemoteControlError` exports; remote queue enqueue-style controls remain intentionally unsupported with `UnsupportedRemoteControlError` until schema-backed queue item contracts land.

  `ProcessManager.verifyContract` now compares the remote contract's group id, version, process ids, queue ids, and control sets against the local contract before reporting success.

  `ControlService` is now contract/REST-first: the legacy `POST /control` command endpoint and command request types were removed, and the CLI now calls the REST routes directly.

  `ProcessManager.ConnectionRegistry.layer` and `ProcessManager.ConnectionRegistry.layerConfig` can now provide typed group connection URLs; `ProcessManager.connect(Group)` and registry-backed `ProcessManager.Endpoint(Group)` can build remote managers from that registry requirement.

  `ProcessManager.cli([GroupA, GroupB])` adds an initial multi-group CLI surface using the connection registry and normalized target resolution for globally unique process and queue ids. It supports `groups`, `ls`, `verify`, `status <target>`, process `start` / `stop` / `restart` / `now`, and queue `pause` / `resume` / `clear`.

  The multi-group CLI supports `--json` output for `groups`, `ls`, `verify`, and `status <target>`.

  The multi-group CLI now checks target contract capabilities before issuing remote status/control requests, so unsupported process and queue commands fail locally before HTTP.

  Adds the first runtime state/fact vocabulary for `RunResource`. Originally landed as a generic `RuntimeObserver` + `RuntimeFact` model; it has since been re-shaped into a per-domain **`RunResourceStore`** storage facet (`@nikscripts/effect-pm/store/RunResource`) — see the separate `process-store-runtime-facet` changeset for the breaking shape. `RunResource` publishes `run-resource.run.started` / `run-resource.run.completed` / `run-resource.run.failed` facts plus `RunResourceState` transitions through `RunResourceStore.recordRunStarted` / `.recordRunCompleted` / `.recordRunFailed` / `.recordStateChange` static optional emitters, which no-op when the facet layer is absent and persist as `run-resource.fact.recorded` / `run-resource.state.changed` analytics events when composed. The Prisma codec supports those event types.

  In-process listeners are implemented by providing a custom service typed as `RunResourceStore.Type` via `Effect.provideService` / `Layer.succeed` — there is no `RuntimeObserver.layerListeners` helper.

  `ProcessStore.events(query)` now provides a generic storage-neutral event read across memory, file-backed, and Prisma implementations. Dedicated queue completion and lifecycle reads are also available across those stores.

  Per-domain projections live directly on the facet: `RunResourceStore.facts({ resourceId, runId?, types? })`, `.stateHistory({ resourceId })`, `.latestState(resourceId)`, `.runs(resourceId)` (paired started + ended history per run), and `.byRun(runId)` (facts for one specific run). There is no `ProcessStore.runtime.*` / `ProcessStore.runResource.*` namespace on the combiner.

  `RunResource` now publishes `RunResourceState` changes for waiting, started, completed, failed, and interrupted runs through `RunResourceStore.recordStateChange`.

  `ProcessStore.file(filePath)` and `ProcessStore.fileLayer(filePath)` add an Effect `FileSystem`-backed NDJSON store for local durable analytics events.

  Adds dedicated package subpaths for service/resource imports (`/Process`, `/QueueResource`, `/ProcessGroup`, `/ProcessStore`, `/ProcessManager`, `/ControlService`) and storage adapters (`/storage/file`, `/storage/prisma`). Root imports and the legacy `/prisma` subpath remain compatible.

  Also fixes `ProcessStore` execution ordering consistency and keyed queue `clear()` dedup cleanup.

### Patch Changes

- Clean stale branch-era docs, add a focused QueueResource example, and repair the combined post-merge type fixes.
- d6beaf3: Update the Effect v4 beta toolchain to `4.0.0-beta.69` and raise the package peer range to `^4.0.0-beta.69`.
- 6ce4729: **QueueResource**: Split worker wake (`takeNext`) from drain-monitor wake so idle workers never unblock `onDrained`; enqueue only wakes workers. The `onDrained` lifecycle hook wakes after queues drain empty following item completion or after `clear`.
- 95cc8e1: **QueueResource**: Replace **`config.refill`** and **`QueueHandle.refill`** with queue-bound lifecycle hooks. Use **`onStart(queue)`** for bootstrap work and **`onDrained(queue)`** after queues drain empty once activity has awakened the drain monitor. Cold-start idle workers do not trigger **`onDrained`**.
- 83bf98c: Document the roadmap to re-enable `anyUnknownInErrorContext` in `@effect/language-service` (see `docs/plans/10-typescript-strict-unknown.md`). Includes small refinements to ControlService, CLI, disarmed idle sleep, shared helpers, HTTP resource/run gate modules, and expanded `ProcessStore` public TSDoc.

## Unreleased

### Minor Changes

- Add `Process.scheduleControls` so schedule controls (`entries`, `set`, `add`, `clear`) are available inside running process effects, matching the controls passed to the `schedule` initializer.
- Add a new schedule-control example (`examples/schedule-control-surfaces.ts`) demonstrating three control surfaces: initializer controls, in-effect controls, and external controller fibers.
- Add two additional schedule-focused examples for organization and breadth: `examples/schedule-control-basics.ts` and `examples/schedule-control-db-sync.ts`.
- Expand schedule-focused tests to cover in-effect schedule controls and change-signal behavior.

## Current beta

### Minor Changes

- **Breaking — effect-first process runtime:** `Process.make` is centered on **`effect`**, with optional **`polling`** (`Polling.spaced`, `Polling.acceleratingScoped`, …) and **`schedule`** (`ProcessSchedule.alwaysArmed`, `ProcessSchedule.cronMatch`, `ProcessSchedule.fromArmedRef`, …) as **layers**. Compose at `make`, via **`Process.providePolling`** / **`Process.provideSchedule`**, or when providing **`process.effect`** at fork time.
- **`Polling` / `ProcessSchedule`:** context services and preset layers; **`ProcessDetails`** / **`ProcessGroup`** status expose **`armed`**, **`nextPollCadence`**, and schedule transition hints where available.
- **Supervisor:** **`start` / `startAll`** attaches schedule drivers; **disarm** pauses scheduled ticks while the fiber **waits** (hint-based or fallback idle sleep, **`Clock`**-aligned); **`cronMatch`** sampling uses the same **`Clock`**.
- **Resource modules:** `QueueResource`, `RunResource`, `HttpClientRunGate`, and `HttpApiResource` use the current class/service patterns documented in **`docs/RESOURCE-API.md`**.
- **Docs & examples:** **`docs/PROCESS-API.md`**, **`docs/RESOURCE-API.md`**, **`examples/queue-resource.ts`**, and the examples index describe the current beta surface.
