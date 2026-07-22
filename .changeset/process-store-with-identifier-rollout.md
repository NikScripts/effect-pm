---
"hyperlink-ts": minor
---

**Identifier-bound storage APIs** for the four facets where it carries
the most weight, plus a doc-comment polish pass across the storage
surface. All additive — no breaking changes.

`ProcessStore.withIdentifier(...)` now decorates these facets with
`Facet.for(id)` / `Facet.withIdentifier(id)` shortcuts that return an
identifier-scoped read (and, where natural, write) API. The unbound
`yield* Facet` shape is unchanged.

Added — `for(id)` bindings
--------------------------

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

Tests
-----

18 new conformance tests covering `for(...)` and `withIdentifier({ id })`
narrowing, scope isolation, identifier-bound writes, and structural
`IdentifierType` accessors — including a brand-new
`test/process-store-process-lifecycle-facet.test.ts` suite. Existing
test surface (254) is unchanged; total now 272 passing.

Documentation
-------------

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
