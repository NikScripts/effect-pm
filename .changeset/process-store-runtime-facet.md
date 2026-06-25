---
"@nikscripts/effect-pm": minor
---

Replace the generic `ProcessStoreRuntime` facet with a per-domain
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
