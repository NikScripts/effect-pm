# Storage

**Single source of truth for persistence in this package.** Read this before changing `src/store/*`, `ProcessStore`, or `RuntimeStorage`.

## Rules

- **Stack:** `RuntimeStorage` (rows) + per-domain facets in `src/store/` (`@nikscripts/effect-pm/store/*`). `ProcessStore` = facet builder. `ProcessStorage` = combined built-in facet layers.
- **One facet per domain.** Each facet owns its concrete fact / change types **and** its row codec — encoders, decoders, predicate builders. No shared envelope. No public `runtime.fact.recorded` wire type.
- **Optional storage.** Domain code uses **static emitters** on facet classes (`ProcessStoreX.recordY(...)`). No-op without layer; write failures logged, never change caller success/error (`ProcessStore` wraps emits).
- **Reads:** `Effect.serviceOption(ProcessStoreX)` then `Option.match({ onNone, onSome: (store) => store.read(...) })` — never static read methods on the facet class. No `Effect.serviceOption(ProcessStore)` monolith in domain modules.
- **No backward compat.** Delete legacy APIs; no `@deprecated` shims.
- **Logs:** capture/relay → `@nikscripts/effect-pm/Logs`. Durable rows → `ProcessStoreLog` (`log.entry`).
- **Durable:** `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`.

Verify: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`

---

## Facets and layout

| Tag | Subpath | File |
|-----|---------|------|
| `ProcessStoreRunResource` | `store/RunResource` | `src/store/runResource.ts` |
| `ProcessStoreQueueResource` | `store/QueueResource` | `src/store/queueResource.ts` |
| `ProcessStoreLog` | `store/Log` | `src/store/log.ts` |
| `ProcessStoreProcessLifecycle` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` |
| `ProcessStoreProcessGroup` | `store/ProcessGroup` | `src/store/processGroup.ts` |
| `ProcessStoreProcessExecution` | `store/ProcessExecution` | `src/store/processExecution.ts` |
| `ProcessStore` | `ProcessStore` | facet builder |
| `ProcessStorage` | `ProcessStorage` | combined built-in facet layers |
| `RuntimeStorage` | `RuntimeStorage` | `src/RuntimeStorage.ts` |

Internal only: `src/internal/store/{spine,service,helpers}.ts` — type-agnostic plumbing (per-facet handle into `RuntimeStorage`, builder, predicate / window helpers). Facet-specific encoders / decoders never live here.

Context key: `@nikscripts/effect-pm/store/<file>/<ServiceTag>`

Import `store/QueueResource` for the **storage facet**, not `@nikscripts/effect-pm/QueueResource` (worker).

---

## Wire events

Each facet writes one or more `RuntimeRecord.type` strings. Records carry `processType` / `processId` / optional `subjectType` / `subjectId` / `key` / `indexA-H` columns the facet uses for indexed predicates; everything else lives in `payload` JSON owned by the facet.

| `type` | Writer | Reader |
|--------|--------|--------|
| `process.execution.completed` | static `recordCompleted` / `recordFailed` / `recordInterrupted` | `yield* ProcessStoreProcessExecution` → `.executions` |
| `process.lifecycle.changed` | static `lifecycleChanged` / `recordMember*` | `yield* ProcessStoreProcessLifecycle` / `ProcessStoreProcessGroup` → read methods |
| `run-resource.fact.recorded` | static `recordRun*` | `yield* ProcessStoreRunResource` → `.facts`, `.runs`, `.byRun` |
| `run-resource.state.changed` | static `recordStateChange` | `yield* ProcessStoreRunResource` → `.stateHistory`, `.latestState` |
| `log.entry` | static `record` / `recordBatch` (relay) | `yield* ProcessStoreLog` → `.load`, `.query` |
| `queue.entry.<status>` × 9 | `QueueResource` worker → static `recordEntry` / `recordEntryBatch` | `yield* ProcessStoreQueueResource` → `.entries`, `.entriesByKey` |
| `queue.lifecycle.<tag>` × 6 | `QueueResource` worker → static `recordLifecycle` / `recordLifecycleBatch` (Started, Paused, Resumed, Shutdown, Cleared, Drained) | `.lifecycle` |
| `queue.dedupe-key.<status>` × 3 | `QueueResource` worker → static `recordDedupeKey` / `recordDedupeKeyBatch` (`added` on enqueue, `released` on completion / clear / drop / dead-letter) | `.dedupeKeys` |

---

## Usage

```ts
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";
import { ProcessStoreProcessExecution } from "@nikscripts/effect-pm/store/ProcessExecution";

yield* ProcessStoreProcessExecution.recordCompleted(input);

const rows = yield* Effect.serviceOption(ProcessStoreProcessExecution).pipe(
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

Template: `src/store/runResource.ts`, tests: `test/process-store-run-resource-facet.test.ts`.

```ts
export class ProcessStoreMyDomain extends ProcessStore.Service<ProcessStoreMyDomain>()(
  "@nikscripts/effect-pm/store/myDomain/ProcessStoreMyDomain",
  ProcessStore.record({
    recordThing: (s) => (fact: MyFact) => s.create(makeMyDomainRecord(fact)),
  }),
  ProcessStore.read((s) => ({
    things: (query?: MyQuery) =>
      s.read(runtimeRecordQuery(myDomainPredicates(query), query?.opts)).pipe(
        Effect.map((records) => projectMyDomain(records, query)),
      ),
  })),
) {}

export declare namespace ProcessStoreMyDomain {
  export type Type = ProcessStore.Service.Type<typeof ProcessStoreMyDomain>;
  export type EmitType = ProcessStore.Service.EmitType<typeof ProcessStoreMyDomain>;
}
```

The `ProcessStoreSpine` handle (`s`) exposes the storage primitives only:

| Method | Purpose |
|--------|---------|
| `s.runId` | Stable per-layer run id stamped onto every write |
| `s.create` / `s.createBatch` | Insert one / many records |
| `s.upsert` | Insert-or-replace one record |
| `s.read(query?)` | Run a `RuntimeRecordQuery` (predicate, orderBy, limit, offset) |
| `s.update(query, patch)` / `s.delete(query)` | Mutating reads |

The facet **owns** all wire-shape work:

- **Encoders** (`makeMyDomainRecord`, etc.) build `Omit<RuntimeRecord, "runId" | "createdAt">` from the facet's domain types.
- **Decoders** project `RuntimeRecord[]` back to the facet's domain types.
- **Predicates** push `processId` / `type` / `key` / `indexA-H` filters into `RuntimeRecordQuery`. Things you cannot index (e.g. payload sub-fields) post-filter after `s.read`.

**Cut-over checklist:** domain types in the facet file → encoders / decoders / predicates inline → static emitters in the feature module that owns the writes → `ProcessStorage.layerRuntimeStorage` merge + `package.json` subpath → conformance test (mirror `test/process-store-run-resource-facet.test.ts`).

**Do not:** add a shared envelope; expose row codecs from `ProcessStore` or `internal/store/`; hand-roll `serviceOption` in feature modules.

**Adapters:** implement `RuntimeStorageService` (e.g. `src/storage/sqlite/`); wire via `ProcessStorage.layerRuntimeStorage` or `layerProcessStore`. Adapters never speak the facet vocabulary — they store and query generic `RuntimeRecord` rows.

---

## Pending work

| Area | Notes |
|------|-------|
| Prisma `RuntimeStorage` adapter | Today `src/prisma/PrismaProcessStore.ts` is a stub that fails at acquisition. The next pass rebuilds it as a `RuntimeStorageService` over normalized `RuntimeRecord` rows. |
| SQLite typed errors | `storage/sqlite` still uses `Layer.orDie` for storage init failures; surface typed errors instead. |
| Telemetry proposals | `Polling`, `ProcessSchedule`, `HttpApiResource`: facet yes/no docs in `docs/storage-proposals/` (Phase 1 — proposal only). |
