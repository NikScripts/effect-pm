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
- Row `type` is generated from telemetry path: `Namespace.Tag.Event`.
- Row `type` is always PascalCase. Do not use legacy lowercase/domain
  discriminators as row type values.
- For app-specific telemetry, row `processType` / `processId` can come from the
  resource/process tag passed to `ProcessStore.telemetry(ResourceTag)`.
- For built-in generic store facets (`RunResourceStore`, `QueueResourceStore`),
  row identity must come from the installed scope because the facet is shared by
  every app resource instance and has no single concrete tag at declaration time.
- Event schemas describe event payload fields, not row identity fields.

## Open recipe steps

### Step 1 — Rich payload input strategy

What this decides:
How `RunResourceStore` telemetry events should accept rich domain payloads
without reintroducing ad hoc per-call record helpers.

Recommended ingredients:
- Use resource/process tags as telemetry identity for app-specific telemetry:
  `ProcessStore.telemetry(RunGate)(...)`.
- Use scope identity for built-in generic facets:
  `RunResourceScope.Schema.State.resourceId` → row `processId`,
  scope definition → row `processType`.
- Treat plain literal fields as constants appended after validation.
- Treat regular schema fields as event input fields.
- Keep `RunResourceStore.Run.Started`, `.Completed`, `.Failed`, and
  `RunResourceStore.State.Changed` as the public emit tree.
- Let generated emitters be function-shaped only when an event schema includes
  regular schema fields.

Picture:

```ts
class RunStarted extends Telemetry.Schema<RunStarted>()(RunScope)({
  runId: RunState.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({
    concurrency: Schema.Number,
  }),
}) {}

class StateChanged extends Telemetry.Schema<StateChanged>()(RunResourceScope)({
  changedAt: Telemetry.terminal.clockMillis,
  reason: Schema.Literal("run-resource.run.completed"),
  previous: Schema.NullOr(RunResourceStateSchema),
  current: RunResourceStateSchema,
}) {}

export class RunResourceStore extends ProcessStore.Service<RunResourceStore>()(
  "@nikscripts/effect-pm/store/runResource/RunResourceStore",
  ProcessStore.telemetry(RunResourceScope)(
    Telemetry.namespace("RunResource"),
    Telemetry.tag("Run")(Telemetry.event("Started", RunStarted)),
  ),
)

yield* RunScope.run({ runId }, RunResourceStore.Run.Started({
  payload: { concurrency },
}))
```

Alternatives:
1. Keep `{ store: (s) => ... }` escape hatches for rich events — fastest, but
   preserves hand-written store legs in facet files.
2. Add one-off `Telemetry.input.fact` / `Telemetry.input.stateChange` helpers —
   less generic, but tightly fits this facet.
3. Flatten every field into schema selectors — type-heavy and awkward for
   nested previous/current state snapshots.

Question:
Should rich event payloads use regular schema fields, with identity derived from
resource tags when a concrete tag exists and from scope when the generic store
facet has no concrete tag?

Recommended answer:
Yes. It removes repeated row identity fields, keeps event schemas focused on
payload, avoids a separate `Telemetry.input.field<T>()` DSL, and still works for
generic built-in facets.

Acceptance check:
`RunResourceStore` can declare all run/state writes with `Telemetry.Schema`,
`RunResource.ts` emits only `RunResourceStore.Run.*` / `State.Changed`, and the
existing run/state projections still pass without legacy `record*` methods.

## Open recipe steps

### Step 2 — Tag identity source

What this decides:
Which identity source can be passed to `ProcessStore.telemetry(...)` to derive
`processType` / `processId`.

Recommended ingredients:
- Use concrete resource/process tags with `kind` and `id` metadata when the
  telemetry declaration belongs to that one tag:
  - `Process` / `Process.Service`: `kind: "process"`, `id`.
  - `QueueResource`: `kind: "queue"`, `id`.
  - `RunResource`: add `kind: "run-resource"`, `id`.
- Use scope classes for built-in generic store facets:
  - `RunResourceScope` → `processType: "run-resource"`, `processId: resourceId`.
  - `QueueScope` → `processType: "queue-resource"`, `processId: queueId`.
- `ProcessStore.telemetry(identity)(...)` maps `kind` → `RuntimeRecord.processType`
  and `id` → `RuntimeRecord.processId`.

Picture:

```ts
// App-specific telemetry can use a concrete tag:
ProcessStore.telemetry(MyRunGate)(
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(
    Telemetry.event("Started", RunStarted),
  ),
)

// generated row identity
{
  type: "RunResource.Run.Started",
  processType: "run-resource",
  processId: MyRunGate.id,
}

// Generic built-in facets use scope identity:
ProcessStore.telemetry(RunResourceScope)(
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(
    Telemetry.event("Started", RunStarted),
  ),
)
```

Alternatives:
1. `Telemetry.facet({ processType, processId })` — explicit and flexible, but
   repeats identity already present on resource tags.
2. Per-event identity fields — rejected; too repetitive and poor DX.

Question:
Should `ProcessStore.telemetry(...)` accept both concrete resource tags and
scope classes as identity sources?

Recommended answer:
Yes. Concrete tags are the best DX when the telemetry belongs to one app
resource, but built-in generic facets need scope-derived identity because they
serve many resource instances.

Acceptance check:
`ProcessStore.telemetry(MyRunGate)(...)` and
`ProcessStore.telemetry(RunResourceScope)(...)` both typecheck. Generated rows
use tag identity for concrete tags and scope identity for generic facets without
event schemas mentioning row identity fields.

## Locked row type examples

```ts
// yes
"RunResource.Run.Started"
"RunResource.Run.Completed"
"RunResource.Run.Failed"
"RunResource.State.Changed"
"Queue.Entry.Enqueued"
"Process.Lifecycle.Started"

// no
"run-resource.run.started"
"run-resource.state.changed"
"queue.entry.enqueued"
"process.lifecycle.changed"
```

## Cleanup status

Open. Delete this recipe once the decision is implemented or moved into
`docs/plans/17-facet-telemetry-factory.md` / `docs/STORAGE.md`.
