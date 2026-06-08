# Telemetry overhaul — requirements & implementation steps

**Status:** Owner-approved bake (Jun 2026); **API revision** locked Jun 2026 (Tag / Wiring / Router — see [change log](#implementation-change-log)). **Implementation gate** for all telemetry work.  
**Design rationale & discussion:** [telemetry-split-bake.md](./telemetry-split-bake.md)  
**Pre-implementation recon:** [telemetry-recon-findings.md](./telemetry-recon-findings.md) (codebase gaps only)  
**Implementation handoff:** [telemetry-implementation-handoff.md](../handoffs/telemetry-implementation-handoff.md) — **start here if implementing**  
**Vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md)  
**Architecture:** [20-process-store-split-and-telemetry.md](../plans/20-process-store-split-and-telemetry.md) · [architecture-split-and-transports.md](./architecture-split-and-transports.md)  
**Golden reference (schemas + wire layout only):** `origin/cursor/facet-telemetry-158c` — not a mechanical port of the factory DSL

**Rule for implementers:** If you introduce a behavior, API shape, or default **not written in this doc**, append it to [§ Undocumented / verify](#undocumented--verify-before-merge) and the [change log](#implementation-change-log) in the same PR.

**Doc code rule:** Snippets must match **locked bake APIs** and **shipped schemas/scopes** (`src/`, golden branch). Rebuild tooling only — not a domain redesign.

**Calling invariants (locked — do not regress to `defineEvent` style):**

1. **No event payloads at call sites** — not `{ payload: { concurrency } }`, not hand-built `Started({ id, occurredAt, … })`. Events are **zero-arg**; the layer materializes from scope, operation input, `Telemetry.terminal.*`, wiring `bind`, and `Exit.*`.
2. **Root / lifetime scope** — install via **`State.Scope.layer` / `.provide` / `.run`** at the kernel boundary that owns that lifetime (Pattern A in [plan 18](../plans/18-resource-state-scope.md)). **Not** on the telemetry operation builder.
3. **Operation scope** — **`.provide(scopeLeaf)` on operations only** (typed from the scope declared on that op's Tag). **Never** `.provide()` on events.
4. **Events are `Effect` values** — `yield* RunResourceTelemetry.State.Changed` — **not** `Changed()` (events are not functions).
5. **Start / exit** — **operation runner** emits when the Tag declares `Telemetry.start` / `Telemetry.exit`. Kernel does **not** `yield* ctx.telemetry.Started` (or any start leg) — start fires immediately on op entry.
6. **Middle events** — `yield* ctx.telemetry.Retried` etc. **inside** an operation body only — materialize from **op scope + op input** established by `.provide()` on that op.
7. **Standalone root-scoped events** — `yield* Service.Group.Event` when root scope is already ambient (e.g. `State.Changed` after `RunResourceScope.layer` on the gate). Leaf-scoped facts require an **operation** with `Telemetry.start` / `Telemetry.exit` — not a bare Service event + `.provide()`.
8. **Exit-first operations** — default op shape is **`Telemetry.exit` only** (how it finished). Add `Telemetry.start` when start matters; add middle `Telemetry.event`s when needed between start and exit.
9. **Operation input ≠ event payload** — `op(input)` passes only what the Tag declares on `Telemetry.operation<Input>`. Scope fields (`runId`, `entryId`, …) go through **`.provide()` on the op**, not operation input.
10. **Wire ids / reason literals** — use **`telemetryWireId`** (or Tag-generated helper), e.g. `STATE_CHANGE_REASONS` — never ad-hoc string literals in schemas or kernel.

---

## Table of contents

0. [Implementer checklist](#implementer-checklist)
1. [What we are building](#1-what-we-are-building)
2. [What we are replacing](#2-what-we-are-replacing)
3. [Four kinds of state (do not conflate)](#3-four-kinds-of-state-do-not-conflate)
4. [Three public APIs (locked)](#4-three-public-apis-locked)
5. [Implementation steps (0–10)](#5-implementation-steps-010)
6. [RunResource — full target](#6-runresource--full-target)
7. [Queue — full target](#7-queue--full-target)
8. [Compose, layers, registry](#8-compose-layers-registry)
9. [Internal emit pipeline](#9-internal-emit-pipeline)
10. [Module layout & exports](#10-module-layout--exports)
11. [Store / RPC (separate track, approved)](#11-store--rpc-separate-track-approved)
12. [Rejected (do not build)](#12-rejected-do-not-build)
13. [Undocumented / verify before merge](#undocumented--verify-before-merge)
14. [Implementation change log](#implementation-change-log)

---

## Implementer checklist

**Handoff:** [telemetry-implementation-handoff.md](../handoffs/telemetry-implementation-handoff.md)

- [ ] Read handoff + this doc (not split-bake for API shape)
- [ ] Use recon for **branch gaps** only — API per [change log 2026-06-08](#implementation-change-log)
- [ ] Implement **`Telemetry.bind.pipe`**, **`satisfies WiringConfig`**, **`Telemetry.layer`**, **`Telemetry.withLayer`**
- [ ] Rename **`TelemetryHub`** → **`TelemetryRouter`** in new/edited code
- [ ] **`*.test-d.ts`** for wiring exhaustiveness
- [ ] Resolve **D5** (`RunResourceStateSchema` home) before deleting debt telemetry file
- [ ] Gate: `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`

---

## 1. What we are building

Replace hub-branch interim telemetry (`defineEvent`, hand wire consts, kernel `Ref` counters) with a **three-API model** plus **router** and optional **transport**:

| # | Name | Public surface | Role |
| --- | --- | --- | --- |
| **1** | **`Telemetry.Tag`** | `Telemetry.Tag<Self>()(id, …tree)` | **Skeleton + calling paths** — namespace, group, operation, event, start, exit, schemas, wire ids, **node handles (G)**. **No** extend, bind, pipe on events. |
| **2** | **Calling API** | Static paths on **Tag** (mirrored on facet export) | Operation builder → `{ input, telemetry, scope }`; **zero-arg** events; runner owns start/exit |
| **3** | **Wiring** | `Wiring.sections(…)` + **`satisfies WiringConfig<Tag>`** | `Telemetry.extend`, `Telemetry.bind(…).pipe(log legs…)` → validated config; **not** a compose function |
| **∴** | **Facet layer** | `Telemetry.layer(Tag, wiring)` | Facet runtime **`Layer`** (materialize, runner, telemetry state) — requires **`TelemetryRouter`** |
| **∴** | **Facet export** | `Telemetry.withLayer(Tag, layer)` | Same calling surface as Tag + **`.layer`** only |
| — | **`TelemetryRouter`** | `TelemetryRouter.layer` (rename of shipped `TelemetryHub`) | In-process validate + fan-out to **sinks** — not definitions, not bind |
| — | **`telemetryTransport`** | `telemetryTransport.serverLayer` | **Wire** for live events (plan 19) — fed by **`BroadcastSink`**, not the router API |

```text
Author time                              Runtime (when facet .layer + router provided)
─────────────────────────────────────────────────────────────────────────────────────
store/RunResourceTag.ts       API 1+2    Kernel: RunResourceTelemetry.* (same paths as Tag)
  Telemetry.Tag(id, tree)

store/RunResourceTelemetry.wiring.ts  API 3
  Wiring.sections(extend, bind.pipe…) satisfies WiringConfig<Tag>

store/RunResourceTelemetry.service.ts
  Telemetry.layer(Tag, wiring)  ───────►  src/internal/telemetry/*  ──emit──►  TelemetryRouter
                                                                                    │
store/RunResourceTelemetry.ts                                                     sinks
  Telemetry.withLayer(Tag, layer)  ──►  .layer          Archive / Projection / Broadcast ──► telemetryTransport
```

**Router** stays validate + fan-out only. **Definitions + bind** live on Tag + wiring. **Transport** is optional wire to remote subscribers.

**Emit `R` at kernel:** empty (no-op stub) **or** **`TelemetryRouter` only** — **never** `RuntimeStorage`.

**Reference order:** RunResource Tag port → Service + internal bridge → registry + delete debt → Queue (separate branch).

---

## 2. What we are replacing

### Current hub-branch debt

```ts
// src/store/RunResourceTelemetry.ts — DELETE this pattern
import { defineEvent, emit, telemetryWireId } from "../TelemetryHub";

export const RUN_STARTED_WIRE = telemetryWireId("RunResource", ["Run"], "Started");
// … duplicate wire const arrays …
export const RunStarted = defineEvent({ wire: RUN_STARTED_WIRE, schema: … });
yield* emit(RunStarted, { resourceId, runId, occurredAt }); // hand-built payload
```

```ts
// src/RunResource.ts — DELETE kernel Ref counters when telemetry state ships
const stateRef = Ref.make({ waiting: 0, inFlight: 0, … });
```

| Delete / replace | Keep |
| --- | --- |
| `TelemetryHub.defineEvent` in facets | `TelemetryHub`, sink modules |
| `RunResourceHubTelemetry` namespace | `ArchiveSink`, `ProjectionSink`, `BroadcastSink` |
| Hand-duplicated wire const arrays | Flat `store/RunResource*.ts` |
| Kernel `stateRef` counters | Transport merge, projection pilot |

### Target call site (kernel — RunResource gate)

**Same schemas** as golden branch / hub branch. **Different call shape:** operation builder + zero-arg events.

```ts
// TODAY — hub debt (DELETE): hand-built event payloads + defineEvent
yield* RunResourceHubTelemetry.Run.started({
  resourceId,
  runId,
  occurredAt,
  payload: { concurrency },
});

// TARGET — operation `run`; runner emits Started/Completed/Failed (zero-arg on wire)
yield* RunResourceTelemetry.Run.run
  .provide({ runId })
  .pipe(Effect.flatMap((ctx) => config.effect(input)));

// State.Changed — Effect (not a function); root ambient from RunResourceScope.layer on gate
yield* RunResourceTelemetry.State.Changed;
// metrics leg updates telemetry state before emit; wiring materializes reason/previous/current
```

---

## 3. Four kinds of state (do not conflate)

From [21-state-vocabulary.md](../plans/21-state-vocabulary.md):

| Term | Who | Storage | Example |
| --- | --- | --- | --- |
| **Process state** | Kernel / business logic | In-memory `State.Scope` | `entryId`, `runId` |
| **Telemetry state** | Telemetry runtime only | Same scope **object**, hidden fields | `waiting`, `inFlight` gauges |
| **Projection state** | `*Projection` live reads | In-memory; optional hydrate | Dashboard “now” |
| **Durable ops state** | Archive facets | `RuntimeStorage` | Leases, rate limits — **not** telemetry |

**Three separate concepts at operation boundary** (owner locked):

| Concept | Visible to process? | Auto-merged into events? |
| --- | --- | --- |
| **Process scope state** | Yes | Yes — scope-bound schema fields materialize from scope |
| **Telemetry state** | **No** (hidden) | Yes — when wiring `extend` adds fields |
| **Operation input** | N/A | **No** — explicit `bind` only |

```ts
// Gate lifetime — root via State.Scope (not telemetry builder)
makeRunGateEffect(config).pipe(
  Effect.provide(RunResourceScope.layer({ resourceId: config.name ?? "anonymous" })),
);

// Queue runtime lifetime — root via State.Scope
makeQueueRuntime(…).pipe(
  Effect.provide(QueueResourceScope.layer({ queueId: queueName })),
);

// Operation — .provide() installs op scope only; queueId / resourceId already ambient
yield* QueueResourceTelemetry.Entry.processEntry({
  key: internal.key,
  priority: internal.priority,
  attempts: internal.attempts,
}).provide({ entryId: internal.entryId }).pipe(
  Effect.flatMap((ctx) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runUserHandler(internal));
      if (shouldRetry(exit, ctx.input.attempts)) {
        yield* ctx.telemetry.Retried; // middle — after work, not first line
      }
      return yield* Exit.match(exit, {
        onFailure: (cause) => Effect.failCause(cause),
        onSuccess: (value) => Effect.succeed(value),
      });
    }),
  ),
);
```

If a value is **already in scope** via `.provide()` on the op, **do not** duplicate it in operation input.

---

## 4. Three public APIs (locked)

### API 1 — `Telemetry.Tag` (skeleton)

**On Tag:** namespace, group, operation, event, start, exit, scope ref, schemas, wire ids, **node handles (G)**.

**Not on Tag** (→ wiring / Service):

- `extend`, `nodes` / `bind`, `logWarning`
- Effect **`Service.layer`**

**DSL rules (locked):**

- `Telemetry.group(...)` — not lowercase `Telemetry.tag(...)` (collision with `Telemetry.Tag`).
- Groups **do not nest**. Groups are the wire path segment.
- Events live under a **group** or **inside an operation** — never directly under namespace.
- Wire ids: **`Namespace.Group.Event`**. Operation names **never** appear in wire ids.
- Input type on **`Telemetry.operation<Input>`**, not on `Telemetry.start`.
- Use **`telemetryWireId` helper** (or Tag-generated equivalent) — **not** string literals for reasons/wires.
- Scope-bound fields (e.g. `runId`, `entryId`) come from **scope at materialize** — **not** re-passed when layer materializes them.
- **`Telemetry.terminal.clockMillis`** for timestamps where golden branch uses terminal fields.

#### RunResource Tag (API 1) — schemas from golden branch, **operations** on call path

Scopes (`src/RunResourceScope.ts`):

```ts
export const RunResourceScope = State.Scope("RunResource", {
  resourceId: Schema.String,
})(…);

export const RunScope = RunResourceScope.withLeaf("Run", {
  runId: Schema.String,
})(…);
```

Wire helpers (same as `src/store/RunResourceTelemetry.ts` — **not** string literals in kernel):

```ts
export const STATE_WAITING_WIRE = telemetryWireId("RunResource", ["State"], "Waiting");
export const STATE_STARTED_WIRE = telemetryWireId("RunResource", ["State"], "Started");
// … Completed, Failed, Interrupted, WaitInterrupted …

export const STATE_CHANGE_REASONS = [
  STATE_WAITING_WIRE,
  STATE_STARTED_WIRE,
  STATE_COMPLETED_WIRE,
  STATE_FAILED_WIRE,
  STATE_INTERRUPTED_WIRE,
  STATE_WAIT_INTERRUPTED_WIRE,
] as const;
```

Schemas (fields unchanged from golden branch):

```ts
const RunState = RunScope.Schema.State;

class RunResourceRunStarted extends Telemetry.Schema<RunResourceRunStarted>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ concurrency: Schema.Number }),
}) {}

class RunResourceRunCompleted extends Telemetry.Schema<RunResourceRunCompleted>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ durationMs: Schema.Number }),
}) {}

class RunResourceRunFailed extends Telemetry.Schema<RunResourceRunFailed>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({
    durationMs: Schema.Number,
    cause: Schema.String,
  }),
}) {}

class RunResourceStateChanged extends Telemetry.Schema<RunResourceStateChanged>()(
  RunResourceScope,
)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
  reason: Schema.Literals(STATE_CHANGE_REASONS),
  previous: Schema.NullOr(RunResourceStateSchema),
  current: RunResourceStateSchema,
}) {}
```

Tag tree — **`run` operation** owns Run start/exit; `State.Changed` standalone event:

```ts
export class RunResourceTag extends Telemetry.Tag<RunResourceTag>(id)(
  Telemetry.namespace("RunResource"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      RunScope,
      Telemetry.start("Started", RunResourceRunStarted),
      Telemetry.exit({
        onSuccess: Telemetry.event("Completed", RunResourceRunCompleted),
        onFailure: Telemetry.event("Failed", RunResourceRunFailed),
      }),
    ),
  ),
  Telemetry.group("State")(
    Telemetry.event("Changed", RunResourceStateChanged),
  ),
) {}
```

Node handles (G) — wiring keys; wire ids stay `RunResource.Run.Started` (operation name **not** in wire):

```ts
RunResourceTag.Run.run.Started          // start leg of `run` op
RunResourceTag.Run.run.exit.onSuccess   // → Completed event handle (CHK-01)
RunResourceTag.Run.run.exit.onFailure   // → Failed event handle
RunResourceTag.State.Changed
```

#### Queue entry operation (API 1) — `processEntry` stress case

Operation input = **`EntryFactSource` fields not on scope leaf** (`key`, `priority`, `attempts`). **`entryId` is scope** via **`.provide()` on the op**. No invented `name` field.

**Exit-first default** — add `Telemetry.start` / middle events only when needed:

```ts
// Enqueue — start-only op (Enqueued = Telemetry.start; runner emits immediately)
Telemetry.operation<{
  key?: string;
  priority: QueuePriority;
  attempts: number;
}>("enqueue")(
  QueueEntryScope,
  Telemetry.start("Enqueued", QueueEntryEnqueued),
);

// Dedupe release — exit-only op (common case: care how it finished)
Telemetry.operation("releaseDedupeKey")(
  QueueDedupeKeyScope,
  Telemetry.exit({
    onSuccess: Telemetry.event("Released", QueueDedupeKeyReleased),
  }),
);

// Worker — start + middle + exit
Telemetry.operation<{
  key?: string;
  priority: QueuePriority;
  attempts: number;
}>("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", QueueEntryStarted),
  Telemetry.event("Retried", QueueEntryRetried),
  Telemetry.operation("rateLimit")({
    onFailure: Telemetry.event("Exceeded", QueueRateLimitExceeded),
  }),
  Telemetry.exit({
    onSuccess: Telemetry.event("Completed", QueueEntryCompleted),
    onFailure: Telemetry.event("Failed", QueueEntryFailed),
    onInterrupt: Telemetry.event("Released", QueueEntryReleased),
  }),
);
```

**Exit-only nested op** inherits parent `QueueEntryScope`. Root-scoped groups (`Lifecycle`, …) stay **events** on the Tag — bare `yield*` when root ambient.

---

### API 2 — Calling (operations + zero-arg events)

**Locked:** telemetry call sites use **Service static paths** — not `Scope.run` + hand-built payload emit.

#### Events vs operations

| Kind | Type | `.provide()`? | Call |
| --- | --- | --- | --- |
| **Event (standalone, root-scoped)** | `Effect` | **No** | `yield* Service.Group.Event` when root ambient |
| **Operation (exit-only or start+exit)** | builder → `Effect` | **Yes** — op's declared scope leaf | `yield* Service.Group.op(input?).provide({ … })` |
| **Operation with body** | builder → `Effect` | **Yes** | `.provide({ … }).pipe(Effect.flatMap(ctx => …))` |
| **Middle event** | `Effect` on `ctx.telemetry` | **No** | `yield* ctx.telemetry.Retried` inside op body |
| **Nested op** | inherits parent scope | **No** extra provide | `yield* work.pipe(ctx.telemetry.rateLimit)` |

**Events are `Effect` values — not functions.** No `()` on `Changed`, `Enqueued`, `Started`, etc.

**`.provide()` is operation-only.** Events inside an op read **op scope + op input**; they never chain `.provide()`.

#### Operation legs (Tag → runner → kernel)

| Leg | Tag DSL | Runner | Kernel |
| --- | --- | --- | --- |
| **Start** (optional) | `Telemetry.start("Enqueued", …)` | emits **immediately** on op entry | **nothing** — do not `yield* ctx.telemetry.Enqueued` |
| **Middle** (optional) | `Telemetry.event("Retried", …)` | on `yield* ctx.telemetry.Retried` | after user work, before op closes |
| **Exit** (default) | `Telemetry.exit({ … })` | on op completion / failure / interrupt | **nothing** — do not call Completed/Failed directly |

**Exit-first:** most ops need only `Telemetry.exit`. Add `Telemetry.start` when how it **started** matters (`enqueue` → `Enqueued`, `processEntry` → `Started`).

#### Scope: `State.Scope` vs operation `.provide()`

| Need | API | Example |
| --- | --- | --- |
| **Root for lifetime** | `State.Scope.layer` / `.provide` / `.run` at factory | `Effect.provide(RunResourceScope.layer({ resourceId }))` |
| **Op scope leaf** | **`.provide({ … })` on the operation** | `Run.run.provide({ runId })` — Tag declares `RunScope` |
| **Other scope level** | that **`State.Scope` directly** | `QueueResourceScope.run({ queueId }, effect)` — not on telemetry builder |

Type of `.provide()` argument = **`Scope.Leaf`** from the scope ref on that operation's Tag.

Builder returns **type error** when: tag declares scope, scope not ambient, `.provide()` not called before the op runs.

**Rejected:** `provideLeaf`, `provideRoot`, `assumingLeaf`, `assumingRoot`; `.provide()` on events; `Event()` function call syntax; extra `telemetry` callback param; bodies on `Telemetry.Tag`; two-arg `(leaf, input)`.

#### RunResource gate (canonical)

```ts
// Gate factory — root once (Pattern A)
return makeRunGateBody(config).pipe(
  Effect.provide(RunResourceScope.layer({ resourceId })),
);

// Per invocation — metrics leg, then standalone root event
yield* RunResourceTelemetry.State.Changed;

yield* RunResourceTelemetry.Run.run
  .provide({ runId })
  .pipe(Effect.flatMap((ctx) => config.effect(input)));
// Runner: Started on entry, Completed | Failed on exit — kernel never yields them
```

#### Queue enqueue (start-only op)

```ts
yield* QueueResourceTelemetry.Entry.enqueue({
  key: source.key,
  priority: source.priority,
  attempts: source.attempts,
}).provide({ entryId: source.entryId });
// Runner emits Enqueued immediately — no flatMap body unless op gains middle legs
```

#### Queue `processEntry` (start + middle + exit)

```ts
yield* QueueResourceTelemetry.Entry.processEntry({
  key: internal.key,
  priority: internal.priority,
  attempts: internal.attempts,
}).provide({ entryId: internal.entryId }).pipe(
  Effect.flatMap((ctx) =>
    Effect.gen(function* () {
      // Started already emitted by runner (Telemetry.start on Tag)

      const exit = yield* Effect.exit(runUserHandler(internal));

      if (shouldRetry(exit, ctx.input.attempts)) {
        yield* ctx.telemetry.Retried;
      }

      yield* checkRateLimit.pipe(ctx.telemetry.rateLimit);

      return yield* Exit.match(exit, {
        onFailure: (cause) => Effect.failCause(cause),
        onSuccess: (value) => Effect.succeed(value),
      });
      // Completed / Failed / Released emitted by runner (Telemetry.exit)
    }),
  ),
);
```

#### Queue dedupe (exit-only op)

```ts
yield* QueueResourceTelemetry.DedupeKey.releaseDedupeKey({})
  .provide({ key: internal.key })
  .pipe(Effect.flatMap((ctx) => releaseKeyWork(internal)));
// Runner emits Released on success — no start leg
```

#### Root-scoped standalone events

```ts
// queueId / resourceId ambient from State.Scope.layer on runtime
yield* QueueResourceTelemetry.Lifecycle.Started;
yield* RunResourceTelemetry.State.Changed;
```

#### Three operation kinds

| Kind | Scope on tag | Call shape |
| --- | --- | --- |
| **Scope-required** | Scope ref on op | `op(input?).provide(scopeLeaf)` → `Effect`; optional `.pipe(flatMap(ctx => …))` when body needed |
| **Scope-inheriting** | No scope (nested) | `op` or `op(input)` inside parent — no extra `.provide()` |
| **Scope-free** | No scope | `op(input)` → `Effect` |

#### `OperationContext` (locked — option C)

```ts
interface OperationContext<
  Input,
  ScopeState,
  TelemetryHandle,
> {
  readonly input: Input;
  readonly telemetry: TelemetryHandle;  // middle events + nested ops only (not start/exit legs)
  readonly scope: ScopeState;            // live view — scope opened by op .provide()
}
```

```ts
Effect.flatMap((ctx) =>
  Effect.gen(function* () {
    const attempts = ctx.input.attempts;
    const entryId = ctx.scope.Entry.entryId;
    yield* doWork;
    yield* ctx.telemetry.Retried;
  }),
);
```

- **`input`** — from `op(input)` only; materialized into middle/exit events via wiring `bind`.
- **`telemetry`** — **middle events and nested ops only** — not start legs (runner owns those).
- **`scope`** — process-visible fields only; hidden telemetry fields **not** on `ScopeState` type.
- **`Scope.patch`** — process-visible mid-op updates on `State.Scope`; impl deferred (Ref vs FiberRef).

Optional v2: `.gen(input, fn)` shortcut — **not v1**.

---

### API 3 — Wiring, facet layer, facet export

**Rejected:**

- `Telemetry.Service(Tag, { extend, nodes })` — wiring object as Service 2nd arg
- `Telemetry.Wiring<Tag>` hand-authored config objects with handle-keyed maps
- `{ ERROR: … }` / branded fake error types for exhaustiveness — use **`satisfies WiringConfig<Tag>`** or **`wiring: WiringConfig<Tag>`** assignability
- `Telemetry.event(…).pipe(…)` on **Tag** — pipe legs are on **`Telemetry.bind` in wiring only**
- **`TelemetryHub`** name — use **`TelemetryRouter`** (see [§ 8 Router vs transport](#router-vs-transport-locked))

**Locked entry points:**

```ts
// store/RunResourceTag.ts — API 1 + 2
export class RunResourceTag extends Telemetry.Tag<RunResourceTag>()(
  "@nikscripts/effect-pm/store/RunResource/RunResourceTag",
  Telemetry.namespace("RunResource"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      RunScope,
      Telemetry.start("Started", RunResourceRunStarted),
      Telemetry.exit({
        onSuccess: Telemetry.event("Completed", RunResourceRunCompleted),
        onFailure: Telemetry.event("Failed", RunResourceRunFailed),
      }),
    ),
  ),
  Telemetry.group("State")(
    Telemetry.event("Changed", RunResourceStateChanged),
  ),
) {}

// store/RunResourceTelemetry.wiring.ts — API 3 (define + type validation)
export const runResourceWiring = Wiring.sections(
  Telemetry.extend(RunResourceScope, {
    waiting: Telemetry.metric.gauge,
    inFlight: Telemetry.metric.gauge,
    completed: Telemetry.metric.counter,
    failed: Telemetry.metric.counter,
    interrupted: Telemetry.metric.counter,
    totalDurationMs: Telemetry.metric.counter,
    configVersion: Telemetry.metric.gauge,
  }),

  Telemetry.bind(RunResourceTag.Run.run.Started, {
    payload: { concurrency: Telemetry.state.from((s) => s.gateConcurrency) },
  }).pipe(
    Telemetry.logWarning(
      "RunResourceStore write failed for run start",
      ({ runId }) => ({ runId: String(runId) }),
    ),
  ),

  Telemetry.bind(RunResourceTag.Run.run.exit.onFailure, {
    payload: { durationMs: Exit.durationMs, cause: Exit.cause },
  }).pipe(
    Telemetry.logWarning(
      "RunResourceStore write failed for run failure",
      ({ runId }) => ({ runId: String(runId) }),
    ),
  ),

  Telemetry.bind(RunResourceTag.State.Changed, {
    id: Telemetry.state.from((s) => s.stateChangeSeq),
    reason: Telemetry.state.from((s) => s.pendingReasonWire),
    previous: Telemetry.state.from((s) => s.pendingPreviousSnapshot),
    current: Telemetry.state.from((s) => s.pendingCurrentSnapshot),
  }).pipe(
    Telemetry.logWarning(
      "RunResourceStore write failed for state change",
      ({ reason }) => ({ reason: String(reason) }),
    ),
  ),
) satisfies WiringConfig<typeof RunResourceTag>

// store/RunResourceTelemetry.service.ts — facet runtime Layer (regular Layer typing)
export const runResourceLayer = Telemetry.layer(RunResourceTag, runResourceWiring)

// store/RunResourceTelemetry.ts — facet export (Tag + .layer)
export const RunResourceTelemetry = Telemetry.withLayer(RunResourceTag, runResourceLayer)
export { RunResourceTag }

// Kernel — same paths as Tag
yield* RunResourceTelemetry.Run.run.provide({ runId }).pipe(…)
yield* RunResourceTelemetry.State.Changed
```

**Identity:** Tag declares **`id` once**. Wiring and layer derive identity from Tag — **no separate id** on wiring or layer factories.

#### `Telemetry.bind` + pipe (log legs)

- **`Telemetry.bind(handle, fields)`** — second arg is **PlainFields shape** (nested like schema), not `{ bind: … }`.
- **`.pipe(Telemetry.logWarning(…), Telemetry.logInfo(…), Telemetry.annotateLogs(…), …)`** — optional legs on that node; v1 must include **`logWarning`** where archive persist can fail (swallow policy).
- **Tag:** `Telemetry.event("Changed", Schema)` — **no pipe**.

#### Node handles (G) + PlainFields

Tag factory generates **`EventNode<Schema>`** handles (e.g. `RunResourceTag.Run.run.Started`).

From each event schema, compute **`PlainFields<Schema>`** — plain `Schema.*` leaves not auto-materialized (see table below).

| Schema field kind | Wiring |
| --- | --- |
| Scope-bound (`RunScope.State.runId`) | **Omit** — auto at materialize |
| Terminal (`Telemetry.terminal.*`) | **Omit** — auto |
| Literal union constrained (`Schema.Literals(STATE_CHANGE_REASONS)`) | **Bind** when value comes from telemetry state (e.g. `reason`) |
| Plain `Schema.*` / nested struct | **Required** in `Telemetry.bind` |

```ts
type BindFields<Schema> = /* nested mirror of PlainFields<Schema>; each leaf is FieldSource */
```

**Exhaustiveness (real types, not fake error objects):**

1. **Define:** `Wiring.sections(…) satisfies WiringConfig<Tag>` → missing bind keys = normal TS missing-property errors.
2. **Layer build:** `Telemetry.layer(tag, wiring)` accepts **`wiring: WiringConfig<Tag>`** only.
3. **Per bind:** second arg assignable to **`BindFields<HandleSchema>`**.
4. **Proof:** `*.test-d.ts` with `@ts-expect-error` for missing/incomplete/wrong-context binds.

**Field sources:** `Operation.input("key")`, `Exit.value` / `Exit.cause` / `Exit.durationMs`, `Clock.now`, `Telemetry.state.from(fn)`.

**No auto-routing** of operation input to events.

#### `WiringConfig<Tag>` shape

```ts
type WiringConfig<Tag> = {
  readonly tag: Tag["id"]
  readonly extend: ReadonlyArray<ExtendEntry>
  readonly binds: RequiredBindMap<Tag>   // PlainFields exhaustiveness
  readonly logs: /* accumulated from bind.pipe legs */
}
```

`RequiredBindMap<Tag>` includes only handles where **`PlainFields ≠ never`**. Zero-plain-field nodes: **`Telemetry.bind` optional**; use `.pipe(log…)` only when needed.

#### Telemetry state (`Telemetry.extend`)

```ts
Telemetry.extend(RunResourceScope, {
  waiting: Telemetry.metric.gauge,
  inFlight: Telemetry.metric.gauge,
  totalDurationMs: Telemetry.metric.counter,
  configVersion: Telemetry.metric.gauge,
})
```

Scope passed to **`Telemetry.extend(scope, fields)`** — not as object-literal key. Factory keys internally by **`scope.id`**.

| Rule | Lock |
| --- | --- |
| Storage | Same object as process scope; process types exclude hidden fields |
| Metric kinds v1 | `gauge`, `counter`, `timestamp`, `duration(from, to)` |
| Writers | Metrics leg + operation runner — **kernel never reads/writes telemetry state** |
| Reducers v1 | Counter bumps on configured **exit wires** only |
| Entry cleanup | Drop entry-scoped hidden fields when op **exit** completes |
| Durable storage | **Never** `RuntimeStorage` |
| Snapshot API | `@internal` v1 |

Runtime Refs live in **`src/internal/telemetry/`**; activated by **`Telemetry.layer`**.

## 5. Implementation steps (0–10)

Each step has **deliverables**, **code target**, **acceptance**, and **verify command**.

**Gate (every step):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`

---

### Step 0 — Package surface & vocabulary

**Deliverables:**

- Export subpaths for `Telemetry`, facet `store/<Domain>Telemetry`, optional `store/<Domain>Tag`.
- Identity modules: `src/<Domain>Identity.ts` with `TypeTag` / `TypeId`.
- Plan 21 vocabulary aligned (four state words, three APIs).

```ts
// src/RunResourceIdentity.ts
export const TypeTag = "@nikscripts/effect-pm/RunResource";
export const TypeId: unique symbol = Symbol.for(TypeTag);
```

**Acceptance:** Docs map matches [§ Module layout](#10-module-layout--exports). No domain subfolders under `store/`.

---

### Step 1 — `Telemetry.Tag` factory (Slice A)

**Deliverables:**

- `Telemetry.Tag<Self>(id)(…tree DSL…)` class factory.
- `Telemetry.namespace`, `Telemetry.group`, `Telemetry.operation`, `Telemetry.start`, `Telemetry.exit`, `Telemetry.event`.
- `Telemetry.Schema` base for event schemas.
- Wire id generation (`Namespace.Group.Event`) — reuse/port `telemetryWireId` from internal store telemetry.
- **Node handle (G) generation** on Tag class static tree.

**Port from:** `origin/cursor/facet-telemetry-158c` `ProcessStore.telemetry` tree → `RunResourceTag`.

**Acceptance:**

```ts
// Compiles; no extend/bind/logWarning on Tag
export class RunResourceTag extends Telemetry.Tag<RunResourceTag>(id)( … ) {}

// Handles exist at compile time
type _ = typeof RunResourceTag.Run.run.Started;
```

**Files:** `src/Telemetry.ts` (or split), `src/store/RunResourceTag.ts`, schemas.

---

### Step 2 — RunResource Tag port (Slice A)

**Deliverables:**

- Full RunResource event tree from golden branch as **`RunResourceTag`** skeleton.
- Schemas with scope selectors (`runId` from `RunScope`, not call-site payload).
- Export via `store/RunResourceTelemetry` (Tag re-exported from Service file or sibling).

**Acceptance:** Tag module imports **without** hub layer. Tree matches golden branch wire layout.

**Do not:** `defineEvent`, hand `RUN_*_WIRE` const arrays in facet (delete in Step 8).

---

### Step 3 — Wiring factory + `WiringConfig` (Slice B)

**Deliverables:**

- `Wiring.sections(…)` collector; type **`WiringConfig<Tag>`** with **`RequiredBindMap<Tag>`**.
- `PlainFields` / **`BindFields<Schema>`** type-level computation.
- `Telemetry.extend(scope, fields)`, **`Telemetry.bind(handle, fields).pipe(log legs…)`**.
- Field sources: `Operation.input`, `Exit.*`, `Clock.now`, **`Telemetry.state.from`**.
- **`*.test-d.ts`** — missing bind, extra keys, wrong leg context.

**Acceptance:**

```ts
export const runResourceWiring = Wiring.sections(
  Telemetry.extend(RunResourceScope, { waiting: Telemetry.metric.gauge }),
  Telemetry.bind(RunResourceTag.Run.run.Started, {
    payload: { concurrency: Telemetry.state.from((s) => s.gateConcurrency) },
  }),
) satisfies WiringConfig<typeof RunResourceTag>
```

---

### Step 4 — Calling API + `OperationContext` (Slice B)

**Deliverables:**

- Calling paths on **Tag**; **mirrored** on **`Telemetry.withLayer`** export.
- Operation builder: **`.provide(scopeLeaf)`** only (typed from Tag scope ref).
- `OperationContext` `{ input, telemetry, scope }` after builder completes.
- Type error when scope obligation unsatisfied (missing `.provide()` when not ambient).
- No-op stub when facet **`.layer`** absent (kernel `R` empty).

**Acceptance:** RunResource `Run.run` + Queue `Entry.enqueue` / `Entry.processEntry` typecheck; **no event payloads** at call sites; events are **`Effect` values** (no `()`).

```ts
yield* RunResourceTelemetry.Run.run.provide({ runId }).pipe(
  Effect.flatMap((ctx) => config.effect(input)),
);

yield* QueueResourceTelemetry.Entry.enqueue({ key, priority, attempts })
  .provide({ entryId: source.entryId });
```

**Deferred v1:** `.gen` shortcut, strict `Operation.input` key enforcement.

---

### Step 5 — `src/internal/telemetry/` runtime (Slice C)

**Deliverables:**

- Telemetry state Refs (same object as scope; hidden field partition).
- Materialize: schema + wiring `bind` + scope selectors + Exit.* / op input.
- Metrics leg → telemetry state updates.
- Entry cleanup on op exit.
- Reducers: counter bumps on exit wires (v1).

**Acceptance:** Unit tests for materialize + PlainFields omit rules + extend metrics.

---

### Step 6 — Operation runner + `Telemetry.layer` + router bridge (Slice C)

**Deliverables:**

- **`Telemetry.layer(tag, wiring)`**: `Layer` requiring **`TelemetryRouter`**.
- **`Telemetry.withLayer(tag, layer)`** facet export.
- Operation runner emits **start** on op entry, **exit** on op completion.
- Middle events via `yield* ctx.telemetry.*`.
- Emit pipeline (see [§ 9](#9-internal-emit-pipeline)).
- `Telemetry.Wire<typeof Tag>` — no raw wire strings in kernel.
- **`bind.pipe` log legs** on persist fail (v1: **`logWarning`** + swallow).

**Acceptance:** Integration test — op start/exit/middle events reach router; layer absent → no-op.

```ts
// Conceptual runner ownership
// 1. op .provide(scopeLeaf) → install scope + emit Telemetry.start (if declared)
// 2. user Effect runs with OperationContext (middle events + nested ops)
// 3. on exit → emit Telemetry.exit legs + metrics + cleanup op scope
```

---

### Step 7 — `Telemetry.registry` + sink catalog (Slice D)

**Deliverables:**

- `Telemetry.registry([RunResourceTelemetry, …])` → explicit compose **`Layer`**.
- **No** module import side effects.
- Catalog: wire ids + schemas from **Service** exports.
- Sinks match by wire id.
- Separate from **`ProcessStore.registry`** (archive only).

**Acceptance:**

```ts
const appLayer = Layer.provideMerge(
  TelemetryRouter.layer,
  RunResourceTelemetry.layer,
  Telemetry.registry([RunResourceTelemetry]),
  ArchiveSink.layerForStore(RunResourceStore, …),
);
```

---

### Step 8 — RunResource kernel migration (Slice D)

**Deliverables:**

- Replace `defineEvent` / manual emit in RunResource kernel with Service Calling API.
- Move counters from kernel `Ref` → telemetry `extend` + emit legs.
- **`State.Changed`** from telemetry state snapshot.
- **Gating = semaphore only** — never read telemetry counters for admission.
- Delete: `RunResourceHubTelemetry`, duplicate wire consts, kernel `stateRef`.

**Process vs telemetry split (locked):**

| Process (kernel) | Telemetry (wiring + layer) |
| --- | --- |
| `Semaphore`, user effect, scopes | `waiting`, `inFlight`, `completed`, `failed`, `interrupted`, `totalDurationMs`, `configVersion` |

**Acceptance:** RunResource tests green; grep clean for `defineEvent` in RunResource facet; no `stateRef` in kernel.

---

### Step 9 — Queue migration (Slice E — separate branch)

**Deliverables:**

- `QueueResourceTag` + `QueueResourceTelemetry` per [§ 7](#7-queue--full-target-stress-case).
- Kernel `QueueResource.ts` migrated to Calling API.
- Zero manual payload construction at emit sites.

**Acceptance:** Queue integration tests; scope fields materialize from `QueueEntryScope` not hand-built objects.

---

### Step 10 — Cleanup & verification

**Deliverables:**

- Delete list fully applied (see [§ 12](#12-rejected-do-not-build)).
- Changeset for public API / behavior changes (owner approval before integration merge).
- Update plan 20/21 if drift found.
- All CHK items resolved or explicitly deferred in change log.

---

## 6. RunResource — full target

Golden branch **schemas** + hub **scopes**. Tag adds **`run` operation**. Kernel uses **builder + zero-arg** — not `RunScope.run` + payloads.

### Tag (API 1)

See [RunResource Tag (API 1)](#runresource-tag-api-1--schemas-from-golden-branch-operations-on-call-path).

### Service (API 3)

See [API 3 wiring example](#api-3--wiring--telemetryservice) — handles under `Run.run.*`, `State.Changed`.

### Kernel migration (`src/RunResource.ts`)

```ts
// BEFORE — delete
yield* RunResourceHubTelemetry.Run.started({ resourceId, runId, occurredAt, payload: { concurrency } });
yield* RunResourceHubTelemetry.State.changed({ id, changedAt, reason, previous, current });

// AFTER — gate factory provides root once
return Effect.gen(function* () {
  const sem = yield* Semaphore.make(concurrency);
  return (input: T) =>
    Effect.gen(function* () {
      const runId = yield* nextRunId;

      yield* publishStateTransition(/* Waiting */);
      yield* RunResourceTelemetry.State.Changed;

      yield* Effect.acquireUseRelease(
        acquirePermit,
        () =>
          RunResourceTelemetry.Run.run
            .provide({ runId })
            .pipe(
              Effect.flatMap((ctx) =>
                Effect.matchCauseEffect(config.effect(input), {
                  onFailure: (cause) => Effect.failCause(cause),
                  onSuccess: (value) => Effect.succeed(value),
                }),
              ),
            ),
        () => Effect.asVoid(sem.release(1)),
      );

      yield* publishStateTransition(/* terminal reason */);
      yield* RunResourceTelemetry.State.Changed;
    });
}).pipe(Effect.provide(RunResourceScope.layer({ resourceId })));
```

Counters off `stateRef` → `extend` on **`RunResourceScope`**. Gating = **semaphore only**.

---

## 7. Queue — full target

Entry worker: **`processEntry` operation** (bake stress case). Enqueue path: **`enqueue` operation** with `Telemetry.start("Enqueued", …)`. Dedupe: **exit-only** ops where possible. Root-scoped groups (`Lifecycle`, …) remain **events** on the Tag — bare `yield*` when root ambient.

### Tag (API 1)

`processEntry` under `Entry` group — see [Queue entry operation](#queue-entry-operation-api-1--processentry-stress-case).

Remaining groups port from `src/store/queueResourceTelemetry.ts` as **events** (not all wrapped in one op):

```ts
Telemetry.group("Lifecycle")( /* Started, Paused, … */ ),
Telemetry.group("DedupeKey")( /* Added, Released, Hydrated */ ),
Telemetry.group("RateLimit")(
  Telemetry.event("Exceeded", QueueRateLimitExceeded),
),
```

### Service (API 3)

Wiring keyed by node handles. `processEntry` start/exit/middle legs + `logWarning` from shipped tree. Plain fields on entry schemas (`id`, `startedAt`, `durationMs`, …) bound in `nodes` — **not** passed at call site.

### Kernel (`enqueue` + `processEntry`)

```ts
// Enqueue — start-only op; runner emits Enqueued
yield* QueueResourceTelemetry.Entry.enqueue({
  key: source.key,
  priority: source.priority,
  attempts: source.attempts,
}).provide({ entryId: source.entryId });

// Worker — processEntry (see API 2 canonical example)
yield* QueueResourceTelemetry.Entry.processEntry({
  key: internal.key,
  priority: internal.priority,
  attempts: internal.attempts,
}).provide({ entryId: internal.entryId }).pipe(
  Effect.flatMap((ctx) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runUserHandler(internal));
      if (shouldRetry(exit, ctx.input.attempts)) {
        yield* ctx.telemetry.Retried;
      }
      return yield* Exit.match(exit, {
        onFailure: (cause) => Effect.failCause(cause),
        onSuccess: (value) => Effect.succeed(value),
      });
    }),
  ),
);

// Lifecycle — root ambient from QueueResourceScope.layer on makeQueueRuntime
yield* QueueResourceTelemetry.Lifecycle.Started;
```

Replace `writeEntryEvent` switch for **started → completed/failed** with `processEntry`. Replace enqueue `Enqueued` emit with **`enqueue` operation**. Dedupe **`releaseDedupeKey`** exit-only op replaces bare `Added`/`Released` emits where applicable.

---

## 8. Compose, layers, registry

### Router vs transport (locked)

| Piece | Module | Role |
| --- | --- | --- |
| **Facet runtime** | `Telemetry.layer(Tag, wiring)` | Materialize, runner, telemetry state → **`TelemetryRouter.emit`** |
| **Router** | **`TelemetryRouter`** (rename **`TelemetryHub`**) | In-process validate + fan-out to sinks |
| **Sinks** | `sink/ArchiveSink`, `ProjectionSink`, `BroadcastSink` | Persist / live projection / live broadcast |
| **Transport** | **`telemetryTransport`** | WebSocket RPC **`/ws/telemetry`** (plan 19); fed by **`BroadcastSink`** |

Durable reads → **`storeTransport`** + archive — not **`telemetryTransport`**.

### Layer matrix (locked)

| Layer | Requires | Provides |
| --- | --- | --- |
| **`TelemetryRouter.layer`** | — | emit router (+ sink registry state) |
| **`RunResourceTelemetry.layer`** | **`TelemetryRouter`** | facet runtime + calling bridge |
| **`RunResourceStore.layerRuntimeStorage`** | `RuntimeStorage` | archive queries |
| **`ArchiveSink.layerForStore(…)`** | storage + router | persist leg |
| **`RunResourceProjection.layerLive`** | router | live projection |
| **`BroadcastSink.layer`** | router | **`TelemetryBroadcast`** |
| **`telemetryTransport.serverLayer`** | broadcast (typical) | live wire stream |
| **`RunResourceCompose.layerPersist`** | explicit merge | convenience — **named only** |

**No monolithic layer** that pulls all facets without an explicit compose name.

### App compose example

```ts
import { Layer } from "effect";
import { TelemetryRouter } from "@nikscripts/effect-pm/TelemetryRouter";
import { RunResourceTelemetry } from "@nikscripts/effect-pm/store/RunResourceTelemetry";
import { RunResourceStore } from "@nikscripts/effect-pm/store/RunResource";
import { ArchiveSink } from "@nikscripts/effect-pm/sink/ArchiveSink";
import { BroadcastSink } from "@nikscripts/effect-pm/sink/BroadcastSink";
import { RunResourceProjection } from "@nikscripts/effect-pm/RunResourceProjection";
import { telemetryTransport } from "@nikscripts/effect-pm/telemetryTransport";

const runResourceStack = Layer.provideMerge(
  TelemetryRouter.layer,
  RunResourceTelemetry.layer,
  Telemetry.registry([RunResourceTelemetry]),
  ArchiveSink.layerForStore(RunResourceStore, { … }),
  RunResourceProjection.layerLive,
  BroadcastSink.layer,
  telemetryTransport.serverLayer,   // optional
);

// Kernel — R = TelemetryRouter inside facet layer when composed
```

### Registry rules (locked)

| Decision | Lock |
| --- | --- |
| Registration | **`Telemetry.registry([…])`** returns **`Layer`** |
| Timing | Layer build — **not** import side effects |
| Members | **`Telemetry.withLayer`** facet exports |
| vs archive | **`ProcessStore.registry`** = archive only |
| Sink matching | By **wire id** from Tag catalog |
| Singleton | **Rejected** |

### Router fan-out (architecture)

```ts
yield* RunResourceTelemetry.Run.run.provide({ runId }).pipe(…);
yield* RunResourceTelemetry.State.Changed;
// facet .layer → TelemetryRouter.emit → sinks → (optional) telemetryTransport
```

---

## 9. Internal emit pipeline

**Location:** `src/internal/telemetry/` — **no public subpath**.

```text
yield* Tag/Export.Group.op.provide(scopeLeaf) → OperationContext
  → runner emits Telemetry.start (if declared — immediately)
  → yield* ctx.telemetry.* (middle only, zero-arg)
  → runner emits Telemetry.exit (zero-arg wire; Exit.* → bind)
OR yield* Tag/Export.Group.Event (standalone Effect — root ambient; no .provide())
    │
    ▼
1. resolve scope (+ OperationContext when operation)
2. materialize: schema + wiring bind + scope selectors + op input + Exit.*
3. metrics leg → telemetry state (extend fields, reducers on exit)
4. validate payload against schema
5. **TelemetryRouter.emit**
6. sinks fan-out (failures isolated per sink; bind.pipe **logWarning** swallow on archive fail)
```

| Decision | Lock |
| --- | --- |
| Flat events | **Rejected** as call pattern — use operations + zero-arg emits |
| Start / exit | **Operation runner** |
| Middle / standalone | **Middle:** `ctx.telemetry.*` inside op. **Standalone:** bare `yield* Tag/Export.Group.Event` when root ambient |
| Wire ids in kernel | **`Telemetry.Wire<typeof Tag>`** |
| Correlation | From **scope** only |
| Emit `R` | None (stub) or **`TelemetryRouter`** — never store |
| Archive | **`ArchiveSink`** — not inline in emit |

**Internal spine** does not import facet wiring modules; kernel uses facet export static paths when **`.layer`** is provided at compose.

---

## 10. Module layout & exports

```text
src/Telemetry.ts                    — Tag, Wiring, layer, withLayer, registry
src/TelemetryRouter.ts              — emit router (rename from TelemetryHub)
src/internal/telemetry/             — runtime (materialize, runner, state Refs)
src/RunResourceIdentity.ts          — TypeTag, TypeId
store/RunResourceTag.ts             — API 1 + 2 (optional split)
store/RunResourceTelemetry.wiring.ts — satisfies WiringConfig<Tag>
store/RunResourceTelemetry.service.ts — Telemetry.layer
store/RunResourceTelemetry.ts       — Telemetry.withLayer + re-export Tag
store/RunResourceStore.ts           — archive facet
src/RunResource.ts                  — worker kernel
src/RunResourceProjection.ts        — live projection
src/telemetryTransport.ts           — live wire (plan 19)
```

| Item | Lock |
| --- | --- |
| Facet barrel | `store/<Domain>Telemetry.ts` → **`Telemetry.withLayer`** |
| Wiring | sibling `*.wiring.ts` — **`satisfies WiringConfig<Tag>`** |
| Tag split | Optional `<Domain>Tag.ts` for catalog-only |
| Router subpath | `@nikscripts/effect-pm/TelemetryRouter` |
| Identity subpath | `@nikscripts/effect-pm/<Domain>Identity` |
| Role folders | No domain subfolders under `store/` |
| Shims | **None** |

### Factory companions (general rule, approved)

Every **`.Service`** factory that represents an injectable capability should have a **`.Tag`** companion for contract/identity (pattern from `RunResource.Service` / `RunResource.Tag`). Effect layers:

```ts
// Eager
Layer.succeed(MyTag, impl);

// Effectful (repo convention)
Layer.effect(MyTag, makeImpl);
// or
Layer.effect(MyTag)(makeImpl);
```

---

## 11. Store / RPC (separate track, approved)

Not blocking telemetry slices A–D; document so agents do not conflate.

**Rename direction:** `ProcessStore` → **`Store`** (archive builder + registry).

**Contract vs handler** (Effect RPC model):

```ts
// Contract — schemas on tag; NO .resolve
export class RunResourceStore extends Store.Tag<RunResourceStore>()(
  "@nikscripts/effect-pm/store/RunResource/RunResourceStore",
  "RunResource",
  {
    Run: Procedure.payload(RunQuery).success(RunResult).failure(RunError),
  },
) {}

// Handler layer — separate
export const RunResourceStoreLive = RunResourceStore.toLayer({
  Run: (req) => Effect.succeed(…),
});
```

**Procedure triplet (locked):**

```ts
Procedure.payload(Query).success(Result).failure(Error);
```

- **`Store.Tag`**: typed to **reject** `.resolve` on procedures — contract only.
- **`Store.Service`**: permits `.resolve(…)` for external consumers.
- RPC-visible failures: `Schema.TaggedError` on contracts.
- Protocol failures: separate `Schema.TaggedError` union (transport), not method failures.

---

## 12. Rejected (do not build)

| Proposal | Why |
| --- | --- |
| `defineEvent` as SSoT | Bypasses tree DSL; caused hub drift |
| Durable `ProcessStore.state` as “telemetry state” | Wrong vocabulary |
| Domain folders under `store/` | Role folders only |
| Flat `events` / `operations` maps | Duplicates Tag tree |
| `Telemetry.event(…).pipe(…)` on Tag | Log legs on **`Telemetry.bind(…).pipe(…)`** in wiring only |
| `Telemetry.Service(Tag, wiringObject)` | **`Wiring.sections` + `Telemetry.layer` + `Telemetry.withLayer`** |
| Handle-keyed `{ [handle]: bind }` maps | **`Telemetry.bind(handle, fields)`** sections |
| Fake `{ ERROR: … }` exhaustiveness types | **`satisfies WiringConfig<Tag>`** + **`wiring: WiringConfig<Tag>`** |
| **`TelemetryHub`** name | **`TelemetryRouter`** |
| `Telemetry.Layer.for(Tag)(…)` | **`Telemetry.layer(tag, wiring)`** for facet runtime only |
| extend / bind / log legs on Tag | On **wiring** only |
| Global telemetry registry singleton | Per-compose Layer |
| Module import registry side effects | Explicit Layer at compose |
| Two-arg `(leaf, input)` at call site | Op `.provide(scopeLeaf)` + separate `op(input)` |
| `provideLeaf` / `provideRoot` / `assuming*` | Single **`.provide()`** on operations; root via **`State.Scope`** at lifetime |
| `.provide()` on events | Scope on ops only; events read op scope + input or ambient root |
| `Event()` function call syntax | Events are **`Effect` values** — `yield* Service.Group.Event` |
| `yield* ctx.telemetry.*` for start legs | **`Telemetry.start`** — runner emits on op entry |
| `Scope.run` + hand-built event payload | Operation `.provide` + zero-arg materialize |
| Extra `telemetry` callback on generator | `ctx.telemetry` on OperationContext |
| Tag-first “package depends only on Tag” store rule | Rejected — `Store.Tag` is **contract with schemas**, not bare DI |
| Kernel reads telemetry counters for gating | Semaphore only |
| Invented op fields (e.g. `name` on RunResource) | Operation input must match Tag `Telemetry.operation<Input>` |
| Ad-hoc wire/reason string literals | `telemetryWireId` + `STATE_CHANGE_REASONS` |

---

## Undocumented / verify before merge

**Do not implement by assumption.** Resolve here or in bake doc, then move to locked section above.

| ID | Topic | Status | What to decide |
| --- | --- | --- | --- |
| **CHK-01** | Exit event handles | **LOCKED (authoring)** | `RunResourceTag.Run.run.exit.onFailure` etc. — wire ids omit operation name |
| **CHK-03** | Facet export shape | **LOCKED** | **`Telemetry.withLayer(Tag, layer)`** — Tag paths + `.layer` |
| **CHK-04** | Zero plain-field events in binds | **LOCKED** | **`Telemetry.bind` optional**; only `PlainFields ≠ never` required in **`WiringConfig.binds`** |
| **CHK-05** | `Operation.input("key")` strict keys | **DEFERRED v2** | Best-effort v1. |
| **CHK-06** | `Scope.patch` implementation | **DEFERRED** | API locked; Ref vs FiberRef internal. |
| **CHK-07** | `.gen(input, fn)` shortcut | **DEFERRED v2** | |
| **CHK-08** | Tracer spans at op boundaries | **DEFERRED v2** | |
| **CHK-09** | `prepare` pipe leg | **DEFERRED** | Plan 17 phase 2 |
| **CHK-12** | Optional plain fields (`Retried.error`) | **LOCKED** | Optional schema field → optional bind key |
| **CHK-13** | `RateLimit.Exceeded` wiring | **DEFERRED** | Slice E (Queue) — full bind table there |
| **CHK-14** | Identity subpath exact string | **LOCKED (authoring)** | `@nikscripts/effect-pm/RunResourceIdentity`; confirm on Step 0 export edit |
| **CHK-15** | Standalone root-scoped events | **LOCKED** | Bare `yield* Tag/Export.Group.Event` when root ambient via `State.Scope.layer` |
| **CHK-16** | Router rename | **LOCKED** | **`TelemetryRouter`** replaces **`TelemetryHub`** |
| **CHK-17** | Bind exhaustiveness proof | **LOCKED** | **`satisfies WiringConfig<Tag>`** at define; **`*.test-d.ts`**; no fake error types |
| **CHK-18** | Literal fields needing state (`reason`) | **LOCKED** | Count as **PlainFields** when value comes from **`Telemetry.state.from`** |

**Resolved (do not re-litigate):**

- Registry accepts **`Telemetry.withLayer`** exports.
- **`Telemetry.extend(scope, fields)`** — not scope object keys.
- **`Telemetry.bind(handle, fields).pipe(log legs…)`** — not `{ bind: … }` wrapper.
- Facet file exports **`withLayer`**; optional Tag split.
- **Calling API:** op-only `.provide()`; events are **Effects**; exit-first ops; `Telemetry.start` = runner.
- **`telemetryTransport`** unchanged; fed by **`BroadcastSink`**.

---

## Implementation change log

Append when implementation adds something **not** in locked sections above.

| Date | Branch | Decision | Owner OK |
| --- | --- | --- | --- |
| 2026-06-07 | cursor/telemetry-redesign-bake-faed | Calling API locked: op-only `.provide()`, events as Effects, exit-first ops, `Telemetry.start` via runner, root via `State.Scope` at lifetime | yes |
| 2026-06-08 | cursor/telemetry-redesign-bake-faed | API revision: `Wiring.sections` + `satisfies WiringConfig<Tag>`; `Telemetry.bind(…).pipe(log legs)`; `Telemetry.layer` + `Telemetry.withLayer`; **`TelemetryRouter`** rename; bind exhaustiveness via real types not fake error objects; `telemetryTransport` via BroadcastSink | yes |

```markdown
| YYYY-MM-DD | cursor/… | Description | yes/no |
```

---

## Quick checklist for agents

- [ ] Step matches slice A–E scope
- [ ] Tag skeleton has no extend/bind/log pipe
- [ ] Wiring: **`satisfies WiringConfig<Tag>`** + **`Telemetry.bind(handle, fields).pipe(…)`**
- [ ] PlainFields exhaustive bind in **`*.test-d.ts`** (real `@ts-expect-error`, no fake ERROR types)
- [ ] Zero-arg event emits — events are **Effects** (no `()`)
- [ ] Operations use **`.provide(scopeLeaf)`** only
- [ ] Root scope via **`State.Scope.layer`** at lifetime
- [ ] Facet export: **`Telemetry.withLayer`**; layer requires **`TelemetryRouter`**
- [ ] Compose uses **`TelemetryRouter.layer`** (not TelemetryHub)
- [ ] No `defineEvent` / no kernel `stateRef` (Step 8+)
- [ ] Emit `R` never includes `RuntimeStorage`
