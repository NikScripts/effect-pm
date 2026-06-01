# RunResource telemetry migration recipe

## Goal

Migrate `RunResourceStore` and `RunResource` telemetry writes from legacy
`ProcessStore.record` static emitters to `ProcessStore.telemetry` with
scope-backed events.

## Non-goals

- Do not migrate `QueueResourceStore` in this recipe.
- Do not keep long-term compatibility shims for old `record*` statics.
- Do not change `RunResource` user-facing gating semantics.

## Mise en place findings

- `RunResourceStore` currently writes two runtime record types:
  `run-resource.fact.recorded` and `run-resource.state.changed`.
- Run facts are rich payloads:
  `RunResourceRunStartedFact`, `RunResourceRunCompletedFact`,
  `RunResourceRunFailedFact`.
- State changes are also rich payloads:
  `RunResourceStateChange` includes previous/current state snapshots.
- `RunResource.ts` currently emits `recordRunStarted`, `recordRunCompleted`,
  `recordRunFailed`, and `recordStateChange`.
- Tests and examples use custom `RunResourceStore.Type` mocks with the legacy
  record method names, including batch methods.

## Locked ingredients

- `State.Scope` root scopes provide root leaf only.
- `withLeaf` child scopes provide child leaf only.
- `Telemetry.Schema(scope)(fields)` handles scope, terminal, literal, and
  simple input fields.
- Event definitions own best-effort logging through `Telemetry.logWarning`.

## Open recipe steps

### Step 1 — Rich payload input strategy

What this decides:
How `RunResourceStore` telemetry events should accept rich domain payloads
without reintroducing ad hoc per-call record helpers.

Recommended ingredients:
- Add typed `Telemetry.input.payload<T>()` / `Telemetry.input.field(...)` support
  for complex event payload fields.
- Keep `RunResourceStore.Run.Started`, `.Completed`, `.Failed`, and
  `RunResourceStore.State.Changed` as the public emit tree.
- Let generated emitters be function-shaped only when an event schema includes
  input fields.

Picture:

```ts
class RunStarted extends Telemetry.Schema<RunStarted>()(RunScope)({
  processType: Schema.Literal("run-resource"),
  processId: RunResourceState.resourceId,
  runId: RunState.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  type: Schema.Literal("run-resource.run.started"),
  payload: Telemetry.input.field<RunResourceRunStartedPayload>("payload"),
}) {}

class StateChanged extends Telemetry.Schema<StateChanged>()(RunResourceScope)({
  processType: Schema.Literal("run-resource"),
  processId: RunResourceState.resourceId,
  changedAt: Telemetry.terminal.clockMillis,
  change: Telemetry.input.field<RunResourceStateChange>("change"),
}) {}

yield* RunScope.run(
  { runId },
  RunResourceStore.Run.Started({ payload: { concurrency } }),
)

yield* RunResourceStore.State.Changed({ change })
```

Alternatives:
1. Keep `{ store: (s) => ... }` escape hatches for rich events — fastest, but
   preserves hand-written store legs in facet files.
2. Add one-off `Telemetry.input.fact` / `Telemetry.input.stateChange` helpers —
   less generic, but tightly fits this facet.
3. Flatten every field into schema selectors — type-heavy and awkward for
   nested previous/current state snapshots.

Question:
Should rich domain payloads use a generic typed `Telemetry.input.field<T>(name)`
ingredient?

Recommended answer:
Yes. It keeps event triggers simple, supports rich payloads without facet-local
store functions, and will also help Queue events later.

Acceptance check:
`RunResourceStore` can declare all run/state writes with `Telemetry.Schema`,
`RunResource.ts` emits only `RunResourceStore.Run.*` / `State.Changed`, and the
existing run/state projections still pass without legacy `record*` methods.

## Cleanup status

Open. Delete this recipe once the decision is implemented or moved into
`docs/plans/17-facet-telemetry-factory.md` / `docs/STORAGE.md`.
