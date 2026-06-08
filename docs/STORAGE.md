# Storage

**Single source of truth for persistence in this package.** Read this before changing `src/store/*`, `ProcessStore`, or `RuntimeStorage`.

## Rules

- **`RuntimeStorage` is all storage** — one **`RuntimeStorage`** service in context.
  Provide one durable adapter (`layerProcessStore`, Prisma, redis, or hybrid).
  Facets: all via `ProcessStorage.layerRuntimeStorage`, or **individual**
  `QueueResourceStore.layerRuntimeStorage` (etc.) for only what you use — each still uses the
  same `RuntimeStorage`. **Hybrid** = one adapter routing internally (e.g. SQL +
  Redis), not a second store beside it. See
  [plans/13-queue-rate-limit-and-operational-storage.md](./plans/13-queue-rate-limit-and-operational-storage.md).
- **Stack:** `RuntimeStorage` (rows) + per-domain facets in `src/store/` (`@nikscripts/effect-pm/store/*`). `ProcessStore` = facet builder. `ProcessStorage` = combined built-in facet layers.
- **One facet per domain.** Each facet owns its concrete fact / change types **and** its row codec — encoders, decoders, predicate builders. No shared envelope. No public `runtime.fact.recorded` wire type.
- **Optional storage.** Domain code uses **static telemetry** on facet stores (`QueueResourceStore.Entry.Enqueued`, …) within the appropriate scopes (`QueueResourceScope.run`, `QueueEntryScope.run`, etc.). No-op without layer; when storage is present, write failures are caught by `Telemetry.logWarning` on each event definition (swallowed to log stream). Use `ProcessStore.catchErrorAndLog(...)` for explicit best-effort telemetry on writes without `logWarning`. Shared optional-emit helpers: `ProcessStore.optionalFacetEmit`, `optionalFacetEmitBatch`, `optionalFacetEmitWithBridge`, `facetHasOwnMethod`.
- **Reads:** `Effect.serviceOption(QueueResourceStore)` (etc.) then `Option.match({ onNone, onSome: (store) => store.read(...) })` — never static read methods on the facet class. No `Effect.serviceOption(ProcessStore)` monolith in domain modules.
- **No backward compat.** Delete legacy APIs; no `@deprecated` shims.
- **Logs:** capture/relay → `@nikscripts/effect-pm/Logs`. Durable rows → `LogStore` (`log.entry`).
- **Durable:** `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`.

Verify: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`

**Telemetry / state vocabulary (Jun 2026):** Emit, archive, projection, process state,
and telemetry state are **different**. Target stack: **`Telemetry.Tag` + `Wiring.sections` +
`Telemetry.layer` + `Telemetry.withLayer`** + **`TelemetryRouter`** + optional sinks — **not**
merged emit on `*Store`. Hub branch still uses interim `defineEvent` (debt). Canonical table:
[plans/21-state-vocabulary.md](./plans/21-state-vocabulary.md). Implementation SSoT:
[recipes/telemetry-requirements.md](./recipes/telemetry-requirements.md).

---

## Facets and layout

| Tag | Subpath | File |
|-----|---------|------|
| `RunResourceStore` | `store/RunResource` | `src/store/RunResource.ts`, `RunResourceStore.ts`, `RunResourceTelemetry.ts` |
| `QueueResourceStore` | `store/QueueResource` | `src/store/queueResource.ts` |
| `LogStore` | `store/Log` | `src/store/log.ts` |
| `ProcessLifecycleStore` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` |
| `ProcessGroupStore` | `store/ProcessGroup` | `src/store/processGroup.ts` |
| `ProcessExecutionStore` | `store/ProcessExecution` | `src/store/processExecution.ts` |
| `ProcessStore` | `ProcessStore` | facet builder |
| `ProcessStorage` | `ProcessStorage` | combined built-in facet layers |
| `RuntimeStorage` | `RuntimeStorage` | `src/RuntimeStorage.ts` |

Internal only: `src/internal/store/{spine,service,helpers}.ts` — type-agnostic plumbing (per-facet handle into `RuntimeStorage`, builder, predicate / window helpers). Facet-specific encoders / decoders never live here.

Context key: `@nikscripts/effect-pm/store/<file>/<ServiceTag>`

Import `store/QueueResource` for the **storage facet**, not `@nikscripts/effect-pm/QueueResource` (worker).

### `ProcessStorage` facet aliases

`ProcessStorage` combines layers **and** exposes facet **store classes** under shorter
property names (same **`Context`** tags as `*Store`):

| Alias | Canonical class |
|-------|----------------|
| **`ProcessStorage.Log`** | **`LogStore`** |
| **`ProcessStorage.QueueResource`** | **`QueueResourceStore`** *(storage facet)* |
| **`ProcessStorage.RunResource`** | **`RunResourceStore`** |
| **`ProcessStorage.ProcessExecution`** | **`ProcessExecutionStore`** |
| **`ProcessStorage.ProcessLifecycle`** | **`ProcessLifecycleStore`** |
| **`ProcessStorage.ProcessGroup`** | **`ProcessGroupStore`** *(storage facet)* — not **`ProcessGroup.Service`**. |

Use either import style; **`Effect.serviceOption`**, **`Layer`**, and static emitters behave identically.

---

## Wire events

Each facet writes one or more `RuntimeRecord.type` strings. Records carry `processType` / `processId` / optional `subjectType` / `subjectId` / `key` / `indexA-H` columns the facet uses for indexed predicates; everything else lives in `payload` JSON owned by the facet.

| `type` | Writer | Reader |
|--------|--------|--------|
| `Process.Execution.Completed` / `.Failed` / `.Interrupted` | `yield* ProcessExecutionStore.Execution.*` (zero-arg; {@link RuntimeEmitContext}) | `yield* ProcessExecutionStore` → `.executions` |
| `Process.Lifecycle.Started` / `.Stopped` / `.Restarted` / `.Errored` / `.Recovered` / `.Disabled` / `.Enabled` | `ProcessLifecycleStore.Lifecycle.*` / `ProcessGroupStore.Lifecycle.*` | `yield* ProcessLifecycleStore` / `ProcessGroupStore` → read methods |
| `RunResource.Run.Started` / `.Completed` / `.Failed` | `RunResource` → `RunResourceStore.Run.*` | `yield* RunResourceStore` → `.facts`, `.runs`, `.byRun` |
| `RunResource.State.Changed` | `RunResource` → `RunResourceStore.State.Changed` | `yield* RunResourceStore` → `.stateHistory`, `.latestState` |
| `log.entry` | static `record` / `recordBatch` (relay) | `yield* LogStore` → `.load`, `.query` |
| `Queue.Entry.*` × 9 | `QueueResource` worker → `QueueResourceStore.Entry.*` within `QueueResourceScope.run` + `QueueEntryScope.run` | `yield* QueueResourceStore` → `.entries`, `.entriesByKey`, `.entryHistory`, `.latestEntryFact`, `.byBatch` |
| `Queue.Lifecycle.*` × 6 | `QueueResource` worker → `QueueResourceStore.Lifecycle.*` within `QueueResourceScope.run`. Worker emits `Added` on enqueue, `Released` on completion/release/drop/dead-letter/clear. `Hydrated` is decode-only (warm-start). | `.lifecycle`, `.latestLifecycleEvent` |
| `Queue.DedupeKey.*` × 3 | `QueueResource` worker → `QueueResourceStore.DedupeKey.*` within `QueueResourceScope.run` + `QueueDedupeKeyScope.run` | `.dedupeKeys` |
| `Queue.RateLimit.Exceeded` × 1 | `QueueResource` worker → `QueueResourceStore.RateLimit.Exceeded` within `QueueResourceScope.run` + `QueueEntryScope.run` when `rateLimit` quota is exceeded (`record: "exceeded"` default; `"off"` to disable) | `.rateLimits` |

---

## Usage

```ts
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";
import { ProcessExecutionStore } from "@nikscripts/effect-pm/store/ProcessExecution";

yield* withRuntimeEmitContext({ processId, scheduleKey, startedAt, completedAt, isStartupRun }, ProcessExecutionStore.Execution.Completed);

const rows = yield* Effect.serviceOption(ProcessExecutionStore).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([]),
      onSome: (store) => store.executions({ processId: "billing/sync" }),
    }),
  ),
);
```

```ts
import { ProcessStorage } from "@nikscripts/effect-pm";

Effect.provide(program, ProcessStorage.layer); // in-memory, all facets
Effect.provide(program, layerProcessStore({ filename: ".effect-pm/data.sqlite" }));
```

---

## Authoring a facet (`ProcessStore.Service`)

Template: `src/store/RunResourceStore.ts`, tests: `test/run-resource-store-facet.test.ts`.

A facet is declared with sections passed to `ProcessStore.Service<Self>()(id, ...sections)`:

| Section | Shape | Adds to the facet |
|--------|-------|-------------------|
| `ProcessStore.telemetry(...)` | `Telemetry.namespace` / `tag` / `event` | Nested PascalCase emit tree (see [plan 17](./plans/17-facet-telemetry-factory.md) §5). |
| `ProcessStore.query((s) => ({ ... }))` | factory of query methods | Instance queries (`yield* store`). |
| `ProcessStore.for((id, s) => ({ ... }))` | factory of bound queries | `Facet.for(id)` returning the bound API. |

`telemetry` is required for writes; `query` is required. `for` is optional.

**Planned telemetry authoring:** `Telemetry.event("Completed", MyEventSchema).pipe(Telemetry.annotateLogs)` —
second arg is a `Telemetry.Schema` class only (scope on schema, not on tag). Not fully implemented yet;
see plan 17.

```ts
export class ProcessStoreMyDomain extends ProcessStore.Service<ProcessStoreMyDomain>()(
  "@nikscripts/effect-pm/store/myDomain/ProcessStoreMyDomain",
  "MyDomain",
  ProcessStore.telemetry(MyDomainScope)(
    Telemetry.namespace("MyDomain"),
    Telemetry.tag("Event")(
      Telemetry.event("Happened", MyEventHappenedSchema).pipe(
        Telemetry.logWarning("MyDomainStore write failed"),
      ),
    ),
  ),
  ProcessStore.query((s) => ({
    // Pure-storage read: every filter is pushed into the predicate, so
    // `query?.opts` (including `limit`) flows straight through.
    things: (query?: MyQuery) =>
      s.read(runtimeRecordQuery(myDomainPredicates(query), query?.opts)).pipe(
        Effect.map((records) => decodeThings(records)),
      ),
    // Post-filter read: an `attributes.X` filter that storage cannot push
    // down. Strip `limit` from the storage query (`windowOpts`) and apply
    // it to the projected result via `applyQueryOpts` — otherwise a
    // sparse post-filter can collapse a `limit: N` query to zero rows.
    thingsScopedByAttribute: (scope: string, opts?: QueryOpts) =>
      s.read(runtimeRecordQuery(myDomainPredicates(undefined), windowOpts(opts))).pipe(
        Effect.map((records) =>
          applyQueryOpts(
            decodeThingsForScope(records, scope),
            opts,
            (thing) => thing.occurredAt,
          ),
        ),
      ),
  })),
  // Optional: if your facet has a natural identifier (resourceId, queueId,
  // processId, …), bind it once via `for(...)` instead of repeating it in
  // every method call. Reuse the same private read helpers as the
  // `ProcessStore.query(...)` section so behavior cannot drift.
  ProcessStore.for((thingId, s) => ({
    things: (query?: Omit<MyQuery, "thingId">) =>
      readThings(s, { thingId, ...query }),
  })),
) {}

export declare namespace ProcessStoreMyDomain {
  export type Type = ProcessStore.Service.Type<typeof ProcessStoreMyDomain>;
  export type EmitType = ProcessStore.Service.EmitType<typeof ProcessStoreMyDomain>;
  // Only declare `IdentifierType` when the facet provides `ProcessStore.for`.
  export type QueryType = ProcessStore.Service.QueryType<typeof ProcessStoreMyDomain>;
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof ProcessStoreMyDomain
  >;
}
```

### Identifier-bound APIs (`Facet.for`)

Facets that have a single dominant identifier expose a sticky-scope binding via
`ProcessStore.for((id, s) => …)`:

```ts
const queue = yield* QueueResourceStore.for("@app/Email");
yield* queue.entries();              // queueId baked in
yield* queue.entriesByKey("user-42"); // queueId still baked in
yield* queue.dedupeKeys();            // queueId still baked in
```

Accepts either a raw string id or `{ id }`. Implement the section by **delegating to private read helpers** that the `ProcessStore.query` section also calls — that way the bound and unbound shapes share a single code path. See `src/store/queueResource.ts` and `src/store/RunResourceStore.ts`.

Built-in `ProcessStore.for` facets (subpath → bound id):

| Facet | Subpath | Binds |
|-------|---------|-------|
| `QueueResourceStore` | `store/QueueResource` | `queueId` |
| `RunResourceStore` | `store/RunResource` | `resourceId` |
| `ProcessLifecycleStore` | `store/ProcessLifecycle` | `processId` |
| `ProcessExecutionStore` | `store/ProcessExecution` | `processId` |
| `ProcessGroupStore` | `store/ProcessGroup` | `groupId` |

The `ProcessStoreSpine` handle (`s`) exposes the storage primitives only:

| Method | Purpose |
|--------|---------|
| `s.runId` | Id minted when the facet spine is built; stamped on every write from that layer. **Not** sufficient alone for live-instance identity — see [plans/12-runtime-identity-and-singleton-runs.md](./plans/12-runtime-identity-and-singleton-runs.md) (`instanceId`, cross-runtime leases). |
| `s.create` / `s.createBatch` | Insert one / many records |
| `s.upsert` | Insert-or-replace one record |
| `s.read(query?)` | Run a `RuntimeRecordQuery` (predicate, orderBy, limit, offset) |
| `s.update(query, patch)` / `s.delete(query)` | Mutating reads |

The facet **owns** all wire-shape work:

- **Encoders** (`makeMyDomainRecord`, etc.) build `Omit<RuntimeRecord, "runId" | "createdAt">` from the facet's domain types.
- **Decoders** project `RuntimeRecord[]` back to the facet's domain types.
- **Predicates** push `processId` / `type` / `key` / `indexA-H` filters into `RuntimeRecordQuery`. Things you cannot index (e.g. payload sub-fields) post-filter after `s.read`.
- **Limit semantics**: when *all* filters compile to `RuntimeRecordPredicate`, pass `query?.opts` straight through — the storage `limit` and the projection `limit` agree. When *any* filter is post-applied in TypeScript, swap to `windowOpts(opts)` at the storage call and `applyQueryOpts(rows, opts, ...)` after decode (see `src/store/processGroup.ts` and `src/store/processExecution.ts` for live examples).

**Cut-over checklist:** domain types in the facet file → encoders / decoders / predicates inline → static emitters in the feature module that owns the writes → `ProcessStorage.layerRuntimeStorage` merge + `package.json` subpath → conformance test (mirror `test/run-resource-store-facet.test.ts`).

**Do not:** add a shared envelope; expose row codecs from `ProcessStore` or `internal/store/`; hand-roll `serviceOption` in feature modules.

**Adapters:** implement `RuntimeStorageService` (e.g. `src/storage/sqlite/`); wire via `ProcessStorage.layerRuntimeStorage` or `layerProcessStore`. Adapters never speak the facet vocabulary — they store and query generic `RuntimeRecord` rows.

`PrismaRuntimeStorage` stores the same normalized rows through a consumer-owned
Prisma client. The generated model is `EffectPmRuntimeRecord`, mapped to the
`effect_pm_runtime_records` table. JSON-shaped runtime fields are serialized
into `*_json` string columns so the adapter can preserve
`RuntimeStorage.memory` null / unset semantics without importing generated
Prisma null sentinels.

`RuntimeStorageError` separates logical failures (duplicate id, readonly row)
from operational failures (connection, schema, query, decode, transaction,
unavailable). Durable adapters map driver and decode failures into those public
tags instead of leaking Prisma / SQLite error types.

SQLite exposes typed acquisition failures from `layerProcessStore`; use
`layerProcessStoreOrDie` only at application edges that intentionally treat
database open/schema failures as defects.

### Storage failure semantics

| Surface | Storage present + failure | Storage absent |
|---------|---------------------------|----------------|
| `RuntimeStorageService` | Fails with `RuntimeStorageError` | Not applicable |
| Facet instance reads/writes | Fail with typed storage/facet errors | Not applicable |
| Static facet emitters | Fail with typed storage/facet errors | No-op success |
| `ProcessStore.catchErrorAndLog(...)` | Logs structured details and succeeds | Succeeds |

Use static emitters directly when storage failure should fail the caller. Pipe
through `ProcessStore.catchErrorAndLog(...)` when a write is observability-only
and must not change process / queue success.

---

## Pending work

| Area | Notes |
|------|-------|
| **Identity & singleton runs** | `instanceId`, in-process + **durable lease** so the same logical process is not running in another program/host. Plan: [plans/12-runtime-identity-and-singleton-runs.md](./plans/12-runtime-identity-and-singleton-runs.md). |
| **Operational storage** | One config for facts + **durable ops state** + audit; `RuntimeStorage.transaction`; facet state/mutate helpers. **Not** telemetry state (in-memory only). Plan: [plans/13-queue-rate-limit-and-operational-storage.md](./plans/13-queue-rate-limit-and-operational-storage.md). |
| **Telemetry split bake** | Locked: **`Telemetry.Tag` + `Wiring.sections` + `Telemetry.layer` + `Telemetry.withLayer`**, registry, telemetry state; replace `defineEvent`. SSoT: [recipes/telemetry-requirements.md](./recipes/telemetry-requirements.md) |
| **Queue `rateLimit`** | Effect `RateLimiter` via `RateLimiterStore` on this stack — not shipped. Same plan **13**. |
| **Extend `configure` / `Service`** | Parity on `Process`, `RunResource`, `HttpApiResource` (see plan **13**). |
| Telemetry proposals | `Polling`, `ProcessSchedule`, `HttpApiResource`: facet yes/no docs in `docs/storage-proposals/` (Phase 1 — proposal only). |
| **Thread index** | [plans/14-conversation-capture-may-2026.md](./plans/14-conversation-capture-may-2026.md) |
