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
- Row `processType` / `processId` come from the resource/process tag passed to
  `ProcessStore.telemetry(ResourceTag)`.
- Event schemas describe event payload fields, not row identity fields.

## Open recipe steps

### Step 1 — Rich payload input strategy

What this decides:
How `RunResourceStore` telemetry events should accept rich domain payloads
without reintroducing ad hoc per-call record helpers.

Recommended ingredients:
- Use resource/process tags as telemetry identity: `ProcessStore.telemetry(RunGate)(...)`.
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
  kind: "run-resource.run.started",
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
  ProcessStore.telemetry(MyRunResource)(
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
Should rich event payloads use regular schema fields, with tag-derived row
identity from `ProcessStore.telemetry(ResourceTag)`?

Recommended answer:
Yes. It removes repeated row identity fields, keeps event schemas focused on
payload, and avoids a separate `Telemetry.input.field<T>()` DSL.

Acceptance check:
`RunResourceStore` can declare all run/state writes with `Telemetry.Schema`,
`RunResource.ts` emits only `RunResourceStore.Run.*` / `State.Changed`, and the
existing run/state projections still pass without legacy `record*` methods.

## Open recipe steps

### Step 2 — Tag identity source

What this decides:
Which tag shape can be passed to `ProcessStore.telemetry(...)` to derive
`processType` / `processId`.

Recommended ingredients:
- Use tags with `kind` and `id` metadata:
  - `Process` / `Process.Service`: `kind: "process"`, `id`.
  - `QueueResource`: `kind: "queue"`, `id`.
  - `RunResource`: add `kind: "run-resource"`, `id`.
- `ProcessStore.telemetry(tag)(...)` maps `kind` → `RuntimeRecord.processType`
  and `id` → `RuntimeRecord.processId`.

Picture:

```ts
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
```

Alternatives:
1. `Telemetry.facet({ processType, processId })` — explicit and flexible, but
   repeats identity already present on resource tags.
2. Per-event identity fields — rejected; too repetitive and poor DX.

Question:
Should `RunResource.Tag` / `RunResource.Service` grow `kind: "run-resource"` and
`id` metadata so the tag can be passed directly to `ProcessStore.telemetry(...)`?

Recommended answer:
Yes. `QueueResource` already has `kind: "queue"` / `id`, and `Process` has
`kind: "process"` / `id`; adding the same metadata to `RunResource` gives a
consistent tag-driven telemetry API.

Acceptance check:
`ProcessStore.telemetry(MyRunGate)(...)` typechecks and generated rows use
`processType: "run-resource"` plus `processId: MyRunGate.id` without event
schemas mentioning either field.

## Cleanup status

Open. Delete this recipe once the decision is implemented or moved into
`docs/plans/17-facet-telemetry-factory.md` / `docs/STORAGE.md`.
