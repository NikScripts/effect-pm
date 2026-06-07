# Telemetry overhaul — requirements & implementation steps

**Status:** Owner-approved bake (Jun 2026). **Implementation gate** for all telemetry work.  
**Design rationale & discussion:** [telemetry-split-bake.md](./telemetry-split-bake.md)  
**Vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md)  
**Architecture:** [20-process-store-split-and-telemetry.md](../plans/20-process-store-split-and-telemetry.md)  
**Golden tree (port from):** `origin/cursor/facet-telemetry-158c` — `ProcessStore.telemetry` DSL in `runResource.ts`

**Rule for implementers:** If you introduce a behavior, API shape, or default **not written in this doc**, append it to [§ Undocumented / verify](#undocumented--verify-before-merge) and the [change log](#implementation-change-log) in the same PR.

---

## Table of contents

1. [What we are building](#1-what-we-are-building)
2. [What we are replacing](#2-what-we-are-replacing)
3. [Four kinds of state (do not conflate)](#3-four-kinds-of-state-do-not-conflate)
4. [Three public APIs (locked)](#4-three-public-apis-locked)
5. [Implementation steps (0–10)](#5-implementation-steps-010)
6. [RunResource — full target](#6-runresource--full-target)
7. [Queue — full target (stress case)](#7-queue--full-target-stress-case)
8. [Compose, layers, registry](#8-compose-layers-registry)
9. [Internal emit pipeline](#9-internal-emit-pipeline)
10. [Module layout & exports](#10-module-layout--exports)
11. [Store / RPC (separate track, approved)](#11-store--rpc-separate-track-approved)
12. [Rejected (do not build)](#12-rejected-do-not-build)
13. [Undocumented / verify before merge](#undocumented--verify-before-merge)
14. [Implementation change log](#implementation-change-log)

---

## 1. What we are building

Replace hub-branch interim telemetry (`defineEvent`, hand wire consts, kernel `Ref` counters) with a **three-API model** composed at the facet:

| # | Name | Public surface | Role |
| --- | --- | --- | --- |
| **1** | **`Telemetry.Tag`** | Class + tree DSL | **Skeleton only** — namespace, group, operation, event, start, exit, scope ref, wire ids. Generates **node handles (G)**. **No** extend, bind, logWarning. |
| **2** | **Calling API** | Static paths on **Service** | Builder (`provideLeaf` / `provideRoot` / `assuming*`) → `Effect` → **`OperationContext`**: `{ input, telemetry, scope }`. `scope` is a **live view**, not a snapshot. |
| **3** | **Service wiring** | 2nd arg to **`Telemetry.Service`** | **`Telemetry.Wiring<Tag>`** = `{ extend, nodes }`. Keyed by Tag **node handles**, not wire strings. |
| **∴** | **`Telemetry.Service`** | `Telemetry.Service(Tag, wiring)` | Tag + wiring merged; facet export; **`Service.layer`** = Effect `Layer` (requires hub). |

```text
Author time                          Runtime (when Service.layer provided)
─────────────────────────────────────────────────────────────────────────
RunResourceTag.ts     API 1          Kernel calls Service static paths
  skeleton tree       ───────►       Operation runner + materialize + hub
RunResourceTelemetry.ts  API 3
  Telemetry.Service(Tag, wiring)
  + .layer              ───────►       src/internal/telemetry/*
```

**Hub** stays router-only (validate + fan-out). **Definitions** live on Tag/Service, not `TelemetryHub.defineEvent`.

**Emit `R` at kernel:** empty (no-op stub) **or** `TelemetryHub` only — **never** `RuntimeStorage`.

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

### Target call site (kernel)

```ts
// No hand-built payloads; no raw wire strings
yield* RunResourceTelemetry.Run.processEntry({ name: run.name })
  .provideLeaf({ runId: run.id, resourceId: run.resourceId })
  .pipe(
    Effect.flatMap((ctx) =>
      Effect.gen(function* () {
        // middle events — zero arg at call site
        yield* ctx.telemetry.StateChanged;
        return yield* userEffect(run);
      }),
    ),
  );
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
// Function arg ≠ telemetry input — telemetry only sees scope + explicit op input
const processEntry = (entry: { id: number; name: string; component: ReactNode }) =>
  pipe(
    QueueResourceTelemetry.Entry.processEntry({ name: entry.name }), // op input subset
    Effect.flatMap((ctx) => processItem(entry)),                       // full entry in kernel only
  );
```

If a value is **already in scope** (kernel put it there via `Scope.run`), **do not** pass it again as operation input.

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
- Scope-bound fields (e.g. `runId`) come from **scope at materialize** — **not** passed in kernel payloads.

```ts
import { Schema } from "effect";
import { Telemetry } from "@nikscripts/effect-pm/Telemetry";
import { RunScope } from "../RunResourceScope";
import {
  RunResourceRunStarted,
  RunResourceRunCompleted,
  RunResourceRunFailed,
} from "./RunResourceSchemas";

export class RunResourceTag extends Telemetry.Tag<RunResourceTag>(id)(
  Telemetry.namespace("RunResource")(
    Telemetry.group("Run")(
      Telemetry.operation<{ name: string }>("processEntry")(
        RunScope,
        Telemetry.start("Started", RunResourceRunStarted),
        Telemetry.exit({
          onSuccess: Telemetry.event("Completed", RunResourceRunCompleted),
          onFailure: Telemetry.event("Failed", RunResourceRunFailed),
        }),
      ),
      Telemetry.group("State")(
        Telemetry.event("Changed", RunResourceStateChanged),
      ),
    ),
  ),
) {}

// Generated node handles (G):
// RunResourceTag.Run.processEntry.Started
// RunResourceTag.Run.processEntry.Completed   (via exit.onSuccess — see CHK-01)
// RunResourceTag.Run.processEntry.Failed
// RunResourceTag.Run.State.Changed
```

**Exit-only operation overload (locked):**

```ts
Telemetry.operation("rateLimit")({
  onSuccess: Telemetry.event("Accepted", QueueRateLimitAccepted),
  onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
});
// = exit mapping only; no scope child; no start; scope-inheriting when nested
```

**Nested operations inherit parent scope** when no scope child:

```ts
Telemetry.operation<QueueEntryInput>("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", QueueEntryStarted),
  Telemetry.operation("rateLimit")({
    onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
  }),
  Telemetry.exit({ … }),
);
```

**Schema example** — scope-bound fields omit from wiring `bind`:

```ts
export class RunResourceRunStarted extends Telemetry.Schema<RunResourceRunStarted>(
  "RunResourceRunStarted",
)({
  resourceId: RunScope.State.resourceId,  // scope-bound — auto at materialize
  runId: RunScope.State.runId,            // scope-bound — NOT passed at call site
  occurredAt: Schema.Number,              // plain — requires wiring bind
  name: Schema.String,                    // plain — bind from Operation.input
}) {}
```

---

### API 2 — Calling

Mimic Effect: **function returning `Effect`**, built with `pipe` / `flatMap` / `gen`.

**Rejected:** extra `telemetry` callback param; bodies on `Telemetry.Tag`; two-arg `(leaf, input)`; `(scopeLeaf, opInput)` as separate positional args.

#### Three operation kinds

| Kind | Scope on tag | Call shape |
| --- | --- | --- |
| **Scope-required** | Leaf and/or root declared | `op(input).provideLeaf(…)` / `.provideRoot(…)` / `.assumingLeaf()` / `.assumingRoot()` → `Effect` |
| **Scope-inheriting** | No scope child (nested) | `op` or `op(input)` → `Effect` immediately |
| **Scope-free** | No scope child (top-level) | `op(input)` → `Effect` immediately |

#### Scope providers (locked names)

| Method | Meaning |
| --- | --- |
| **`provideLeaf(leaf)`** | Install leaf scope for this op |
| **`provideRoot(root)`** | Install root when not ambient |
| **`assumingLeaf()`** | Leaf already in `R` (process bracketed) |
| **`assumingRoot()`** | Root already in `R` |

**Explicit `assuming*` over ambient inference in v1.**

Builder returns **type error** when: tag declares scope, scope not ambient, builder never completes with provide/assuming.

**Mid-op `patch` does not replace builder obligation** at op start.

```ts
// Pattern A — telemetry opens leaf at op boundary
const processEntry = (entry: FullEntry) =>
  pipe(
    QueueResourceTelemetry.Entry.processEntry({ name: entry.name })
      .provideLeaf({ entryId: entry.id, attempts: entry.attempts }),
    Effect.flatMap((ctx) =>
      Effect.gen(function* () {
        yield* ctx.telemetry.Retried;
        yield* checkRateLimit.pipe(ctx.telemetry.rateLimit);
        return yield* processItem(entry);
      }),
    ),
  );

yield* processEntry(entry);
```

```ts
// Pattern B — process already bracketed scope
QueueEntryScope.run({ entryId: entry.id, attempts: entry.attempts },
  pipe(
    QueueResourceTelemetry.Entry.processEntry({ name: entry.name }).assumingLeaf(),
    Effect.flatMap((ctx) => …),
  ),
);
```

```ts
// Nested scope-inheriting op
yield* checkRateLimit.pipe(
  QueueResourceTelemetry.Entry.rateLimit,
  Effect.flatMap((ctx) => …),
);
```

```ts
// Scope-free op
yield* QueueResourceTelemetry.Backfill.reconcile({ fromSeq: 100, toSeq: 200 });
```

#### `OperationContext` (locked — option C)

```ts
interface OperationContext<
  Input,
  ScopeState,
  TelemetryHandle,
> {
  readonly input: Input;
  readonly telemetry: TelemetryHandle;  // Retried, rateLimit, nested shortcuts
  readonly scope: ScopeState;          // live view — same Context provideLeaf opened
}
```

```ts
Effect.flatMap((ctx) =>
  Effect.gen(function* () {
    yield* ctx.telemetry.Retried;
    ctx.input.name;
    ctx.scope.entryId;
    yield* QueueEntryScope.patch({ attempts: ctx.scope.attempts + 1 });
  }),
);
```

- **`input`** — from `op(input)` only; not from scope.
- **`telemetry`** — middle events and nested ops.
- **`scope`** — process-visible fields only; hidden telemetry fields **not** on `ScopeState` type.
- **`Scope.patch`** — process-visible mid-op updates; impl deferred (Ref vs FiberRef).

Optional v2: `.gen(input, fn)` shortcut — **not v1**.

---

### API 3 — Wiring + `Telemetry.Service`

**Rejected:** `Telemetry.Layer.for(Tag)(…)`, `Telemetry.layer(tag, config)` as public API (naming collision with Effect `Layer` / `Service.layer`).

**Locked entry point:**

```ts
export const RunResourceTelemetry = Telemetry.Service(RunResourceTag, {
  extend: {
    [RunScope]: {
      waiting: Telemetry.metric.gauge,
      inFlight: Telemetry.metric.gauge,
      completed: Telemetry.metric.counter,
      failed: Telemetry.metric.counter,
    },
  },
  nodes: {
    [RunResourceTag.Run.processEntry.Started]: {
      bind: { name: Operation.input("name") },
      // occurredAt: Clock.now — if plain field on schema
    },
    [RunResourceTag.Run.processEntry.exit.onFailure]: {
      logWarning: Telemetry.logWarning(
        "RunResourceStore write failed for Run.Failed",
        ({ runId }) => ({ runId: String(runId) }),
      ),
    },
  },
});

// RunResourceTelemetry.layer : Layer<TelemetryHub, …>
// RunResourceTelemetry.Run.processEntry(…) — Calling API static paths
```

**Split files (same API):**

```ts
// store/RunResourceTag.ts
export class RunResourceTag extends Telemetry.Tag<RunResourceTag>(id)( … ) {}

// store/RunResourceTelemetry.wiring.ts
export const runResourceWiring = {
  extend: { … },
  nodes: { … },
} satisfies Telemetry.Wiring<typeof RunResourceTag>;

// store/RunResourceTelemetry.ts
export const RunResourceTelemetry = Telemetry.Service(RunResourceTag, runResourceWiring);
export { RunResourceTag };
```

#### Node handles (G) + exhaustive bind

Tag factory generates **`EventNode<Schema>`** handles:

```ts
RunResourceTag.Run.processEntry.Started   // EventNode<typeof RunResourceRunStarted>
RunResourceTag.Run.State.Changed
```

**`nodes` map keyed by handles — not wire strings.**

From each event schema, compute **`PlainFields<Schema>`** — keys whose fields are plain `Schema.*` (not scope-bound, not terminal, not literal).

| Schema field kind | Wiring `bind` |
| --- | --- |
| Scope-bound (`RunScope.State.runId`) | **Omit** — auto at materialize |
| Terminal / literal | **Omit** — auto |
| Plain `Schema.*` | **Required** in `bind` |

```ts
type LayerNodeConfig<Schema> = PlainFields<Schema> extends never
  ? { logWarning?: TelemetryLogWarningConfig }
  : {
      bind: { [K in PlainFields<Schema>]: FieldSource };
      logWarning?: TelemetryLogWarningConfig;
    };
```

**Exhaustiveness:** every Tag `EventNode` with `PlainFields ≠ never` must appear in `nodes` with complete `bind` — else **compile error**.

**`logWarning`** optional on **any** node (even zero plain-field nodes).

**Field sources:** `Operation.input("key")`, `Exit.value`, `Exit.cause`, `Exit.durationMs`, `Clock.now`, `Telemetry.state`.

**No auto-routing** of operation input to scope or events.

#### Telemetry state (`extend` on wiring)

```ts
extend: {
  [RunScope]: {
    waiting: Telemetry.metric.gauge,
    inFlight: Telemetry.metric.gauge,
    totalDurationMs: Telemetry.metric.counter,
    configVersion: Telemetry.metric.gauge,
  },
  [QueueEntryScope]: {
    enqueuedAt: Telemetry.metric.timestamp,
    startedAt: Telemetry.metric.timestamp,
    waitMs: Telemetry.metric.duration("enqueuedAt", "startedAt"),
  },
},
```

| Rule | Lock |
| --- | --- |
| Storage | Same object as process scope; process types exclude hidden fields |
| Metric kinds v1 | `gauge`, `counter`, `timestamp`, `duration(from, to)` |
| Writers | Metrics leg + operation runner — **kernel never reads/writes telemetry state** |
| Reducers v1 | Counter bumps on configured **exit wires** only |
| Entry cleanup | Drop entry-scoped hidden fields when op **exit** completes |
| Durable storage | **Never** `RuntimeStorage` |
| Snapshot API | `@internal` v1 |

Runtime Refs live in **`src/internal/telemetry/`**; activated by **`Service.layer`**.

---

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
type _ = typeof RunResourceTag.Run.processEntry.Started;
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

### Step 3 — `Telemetry.Wiring` + `Telemetry.Service` (Slice B)

**Deliverables:**

- Type `Telemetry.Wiring<Tag> = { extend, nodes }`.
- `PlainFields<Schema>` type-level computation.
- `Telemetry.Service(tag, wiring)` merge — static Calling paths + wiring metadata.
- Optional `Telemetry.wiring<Tag>(config)` helper (`satisfies` only).
- Field source builders: `Operation.input`, `Exit.*`, `Clock.now`, `Telemetry.state`.

**Acceptance:**

```ts
export const runResourceWiring = {
  extend: { [RunScope]: { waiting: Telemetry.metric.gauge } },
  nodes: {
    [RunResourceTag.Run.processEntry.Started]: {
      bind: { name: Operation.input("name") },
    },
  },
} satisfies Telemetry.Wiring<typeof RunResourceTag>;

// Missing bind for plain field → @ts-expect-error in *.test-d.ts
```

---

### Step 4 — Calling API + `OperationContext` (Slice B)

**Deliverables:**

- Static operation paths on composed Service.
- Builder: `provideLeaf`, `provideRoot`, `assumingLeaf`, `assumingRoot`.
- `OperationContext` `{ input, telemetry, scope }` after builder completes.
- Type error when scope obligation unsatisfied.
- No-op stub when `Service.layer` absent (kernel `R` empty).

**Acceptance:** Queue `processEntry` stress case typechecks:

```ts
yield* pipe(
  QueueResourceTelemetry.Entry.processEntry({ name: entry.name })
    .provideLeaf({ entryId: entry.entryId, attempts: entry.retries + 1 }),
  Effect.flatMap((ctx) =>
    Effect.gen(function* () {
      yield* checkRateLimit.pipe(ctx.telemetry.rateLimit);
      yield* ctx.telemetry.Retried;
      return yield* handler(entry.payload);
    }),
  ),
);
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

### Step 6 — Operation runner + `Service.layer` + hub bridge (Slice C)

**Deliverables:**

- **`Service.layer`**: `Layer` requiring `TelemetryHub`.
- Operation runner emits **start** on op entry, **exit** on op completion.
- Middle events via `yield* ctx.telemetry.*`.
- Emit pipeline (see [§ 9](#9-internal-emit-pipeline)).
- `Telemetry.Wire<typeof Service>` — no raw wire strings in kernel.
- `logWarning`: persist fail → log + swallow.

**Acceptance:** Integration test — op start/exit/middle events reach hub; layer absent → no-op.

```ts
// Conceptual runner ownership
// 1. builder completes → open scope + emit Started
// 2. user Effect runs with OperationContext
// 3. on exit → emit Completed/Failed + metrics leg + cleanup entry scope
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
  TelemetryHub.layer,
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

### Tag (API 1)

```ts
export class RunResourceTag extends Telemetry.Tag<RunResourceTag>(id)(
  Telemetry.namespace("RunResource")(
    Telemetry.group("Run")(
      Telemetry.operation<{ name: string }>("processEntry")(
        RunScope,
        Telemetry.start("Started", RunResourceRunStarted),
        Telemetry.exit({
          onSuccess: Telemetry.event("Completed", RunResourceRunCompleted),
          onFailure: Telemetry.event("Failed", RunResourceRunFailed),
          onInterrupt: Telemetry.event("Interrupted", RunResourceRunInterrupted),
        }),
      ),
    ),
    Telemetry.group("State")(
      Telemetry.event("Changed", RunResourceStateChanged),
    ),
  ),
) {}
```

### Service (API 3)

```ts
export const RunResourceTelemetry = Telemetry.Service(RunResourceTag, {
  extend: {
    [RunScope]: {
      waiting: Telemetry.metric.gauge,
      inFlight: Telemetry.metric.gauge,
      completed: Telemetry.metric.counter,
      failed: Telemetry.metric.counter,
      interrupted: Telemetry.metric.counter,
      totalDurationMs: Telemetry.metric.counter,
      configVersion: Telemetry.metric.gauge,
    },
  },
  nodes: {
    [RunResourceTag.Run.processEntry.Started]: {
      bind: { name: Operation.input("name") },
    },
    [RunResourceTag.Run.State.Changed]: {
      // scope-bound + telemetry state fields — likely PlainFields never or minimal bind
    },
  },
});
```

### Kernel (API 2)

```ts
yield* RunResourceTelemetry.Run.processEntry({ name: spec.name })
  .provideLeaf({ runId, resourceId })
  .pipe(
    Effect.flatMap((ctx) =>
      Effect.gen(function* () {
        yield* ctx.telemetry.State.Changed;
        return yield* runUserEffect(spec);
      }),
    ),
  );
```

### Scope today → target

```ts
// TODAY (debt) — manual payloads
RunScope.run({ runId, resourceId },
  Effect.gen(function* () {
    yield* RunResourceStore.Run.Started({ resourceId, runId, occurredAt: Date.now() });
  }),
);

// TARGET — zero-arg middle/exit reads scope; start wired by runner
RunScope.run({ runId, resourceId },
  RunResourceTelemetry.Run.processEntry({ name }).assumingLeaf().pipe(
    Effect.flatMap((ctx) => …),
  ),
);
```

---

## 7. Queue — full target (stress case)

Locked end-to-end reference for Calling + wiring + nested ops.

### Tag (API 1)

```ts
export class QueueResourceTag extends Telemetry.Tag<QueueResourceTag>(id)(
  Telemetry.namespace("Queue")(
    Telemetry.group("Entry")(
      Telemetry.operation<{ name: string }>("processEntry")(
        QueueEntryScope,
        Telemetry.start("Started", QueueEntryStarted),
        Telemetry.event("Retried", QueueEntryRetried),
        Telemetry.operation("rateLimit")({
          onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
        }),
        Telemetry.exit({
          onSuccess: Telemetry.event("Completed", QueueEntryCompleted),
          onFailure: Telemetry.event("Failed", QueueEntryFailed),
          onInterrupt: Telemetry.event("Released", QueueEntryReleased),
        }),
      ),
    ),
  ),
) {}
```

### Service (API 3)

```ts
export const QueueResourceTelemetry = Telemetry.Service(QueueResourceTag, {
  extend: {
    [QueueEntryScope]: {
      enqueuedAt: Telemetry.metric.timestamp,
      waitMs: Telemetry.metric.duration("enqueuedAt", "startedAt"),
    },
  },
  nodes: {
    [QueueResourceTag.Entry.processEntry.Started]: {
      bind: { name: Operation.input("name") },
    },
    [QueueResourceTag.Entry.processEntry.exit.onFailure]: {
      logWarning: Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Failed",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    },
  },
});
```

### Kernel (API 2)

```ts
yield* pipe(
  QueueResourceTelemetry.Entry.processEntry({ name: entry.name })
    .provideLeaf({ entryId: entry.entryId, attempts: entry.retries + 1 }),
  Effect.flatMap((ctx) =>
    Effect.gen(function* () {
      yield* checkRateLimit.pipe(ctx.telemetry.rateLimit);
      yield* ctx.telemetry.Retried;
      return yield* handler(entry.payload);
    }),
  ),
);
```

---

## 8. Compose, layers, registry

### Layer matrix (locked)

| Layer | Requires | Provides |
| --- | --- | --- |
| `TelemetryHub.layer` | — | emit router |
| `RunResourceTelemetry.layer` | hub | telemetry state + Calling API + emit bridge |
| `RunResourceStore.layerRuntimeStorage` | `RuntimeStorage` | archive queries |
| `ArchiveSink.layerForStore(…)` | storage + hub | persist leg |
| `RunResourceProjection.layerLive` | hub | live projection |
| `RunResourceCompose.layerPersist` | explicit merge | convenience — **named only** |

**No monolithic layer** that pulls all facets without an explicit compose name.

### App compose example

```ts
import { Layer } from "effect";
import { TelemetryHub } from "@nikscripts/effect-pm/TelemetryHub";
import { RunResourceTelemetry } from "@nikscripts/effect-pm/store/RunResourceTelemetry";
import { RunResourceStore } from "@nikscripts/effect-pm/store/RunResource";
import { ArchiveSink } from "@nikscripts/effect-pm/sink/ArchiveSink";
import { RunResourceProjection } from "@nikscripts/effect-pm/RunResourceProjection";

const runResourceStack = Layer.provideMerge(
  TelemetryHub.layer,
  RunResourceTelemetry.layer,
  Telemetry.registry([RunResourceTelemetry]),
  ArchiveSink.layerForStore(RunResourceStore, { … }),
  RunResourceProjection.layerLive,
);

// Kernel provide — emit works; R = TelemetryHub at emit sites inside layer
```

### Registry rules (locked)

| Decision | Lock |
| --- | --- |
| Registration | **`Telemetry.registry([...services])`** returns **`Layer`** |
| Timing | Layer build — **not** import side effects |
| Members | **`Telemetry.Service`** exports |
| vs archive | **`ProcessStore.registry`** = archive facets only |
| Sink matching | By **wire id** from catalog |
| Singleton | **Rejected** |

### Hub fan-out (architecture)

```ts
// Emit path — no store required
yield* RunResourceTelemetry.Run.processEntry(…)
// R = TelemetryHub

// Optional legs at compose:
// ArchiveSink → RuntimeStorage.create
// ProjectionSink → in-memory read model
// BroadcastSink → subscribers
```

---

## 9. Internal emit pipeline

**Location:** `src/internal/telemetry/` — **no public subpath**.

```text
yield* ctx.telemetry.SomeEvent   (middle)
  OR operation runner (start/exit)
    │
    ▼
1. resolve scope + OperationContext
2. materialize payload: schema + wiring bind + scope selectors + Exit.* / op input
3. metrics leg → telemetry state (extend fields, reducers on exit)
4. validate payload against schema
5. TelemetryHub.emit
6. sinks fan-out (failures isolated per sink; logWarning swallow on archive fail)
```

| Decision | Lock |
| --- | --- |
| Start / exit | **Operation runner** |
| Middle events | **`yield* ctx.telemetry.*`** |
| Wire ids in kernel | **`Telemetry.Wire<typeof Service>`** |
| Correlation | From **scope** only |
| Emit `R` | None (stub) or **`TelemetryHub`** — never store |
| Archive | **`ArchiveSink`** — not inline in emit |

**Internal spine** does not import facet wiring modules for its own wiring; kernel uses Service static paths when **`Service.layer`** is provided at compose.

---

## 10. Module layout & exports

```text
src/Telemetry.ts                    — Tag factory, Service compose, registry, Wiring types
src/TelemetryHub.ts                 — hub router (existing)
src/internal/telemetry/             — runtime (materialize, runner, state Refs)
src/RunResourceIdentity.ts          — TypeTag, TypeId
store/RunResourceTag.ts             — API 1 skeleton (optional split)
store/RunResourceTelemetry.ts       — Telemetry.Service export + re-export Tag
store/RunResourceStore.ts           — archive facet (separate concern)
store/RunResource.ts                — store/RunResource barrel subpath
src/RunResource.ts                  — worker kernel
src/RunResourceProjection.ts        — live projection
```

| Item | Lock |
| --- | --- |
| Facet telemetry file | `store/<Domain>Telemetry.ts` → **`Telemetry.Service`** |
| Tag split | Optional `<Domain>Tag.ts` for catalog-only imports |
| Identity | `src/<Domain>Identity.ts`; facets import identity, not worker |
| Subpath | `store/<Domain>Telemetry`; identity `@nikscripts/effect-pm/<Domain>Identity` |
| Role folders | No domain subfolders (`store/runResource/` forbidden) |
| Shims | **None** — update every import on move |

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
| Flat `events` / `operations` maps on Service | Duplicates Tag tree |
| `logWarning` on Tag or `.pipe` on Tag event node | **`logWarning:`** property on **wiring** node |
| `Telemetry.Layer.for` / `Telemetry.layer(tag, config)` | Wiring is Service 2nd arg |
| extend / bind / logWarning on Tag skeleton | On **`Telemetry.Wiring`** only |
| Global telemetry registry singleton | Per-compose Layer |
| Module import registry side effects | Explicit Layer at compose |
| Two-arg `(leaf, input)` at call site | Builder `provideLeaf` / `assuming*` |
| Extra `telemetry` callback on generator | `ctx.telemetry` on OperationContext |
| Tag-first “package depends only on Tag” store rule | Rejected — `Store.Tag` is **contract with schemas**, not bare DI |
| Kernel reads telemetry counters for gating | Semaphore only |
| `RuntimeStorage` on emit path | Hub only |

---

## Undocumented / verify before merge

**Do not implement by assumption.** Resolve here or in bake doc, then move to locked section above.

| ID | Topic | Status | What to decide |
| --- | --- | --- | --- |
| **CHK-01** | Exit event node handles | **OPEN** | Wiring uses `RunResourceTag.Run.processEntry.exit.onFailure`. Confirm vs flat `…Failed` / `…Completed` handles. |
| **CHK-03** | `Telemetry.Service` return shape | **OPEN** | Class instance vs namespace object vs branded const — affects `typeof` + registry. |
| **CHK-04** | Zero plain-field events in `nodes` | **CLARIFY** | Only `PlainFields ≠ never` required, or must all events appear? |
| **CHK-05** | `Operation.input("key")` strict keys | **DEFERRED v2** | Best-effort v1. |
| **CHK-06** | `Scope.patch` implementation | **DEFERRED** | API locked; Ref vs FiberRef internal. |
| **CHK-07** | `.gen(input, fn)` shortcut | **DEFERRED v2** | |
| **CHK-08** | Tracer spans at op boundaries | **DEFERRED v2** | |
| **CHK-09** | `prepare` pipe leg | **DEFERRED** | Plan 17 phase 2 |
| **CHK-12** | Optional plain fields (`Retried.error`) | **CLARIFY** | Required bind vs optional omit? |
| **CHK-13** | Nested op wiring (`rateLimit.Rejected`) | **OPEN** | Own `nodes` entry if schema has plain fields? |
| **CHK-14** | Identity subpath exact string | **OPEN** | Confirm on first export. |

**Resolved (do not re-litigate):**

- Registry accepts **Service** exports.
- `extend` on **wiring**, not Tag.
- Facet file exports **Service**, optional Tag split.
- `logWarning:` property on wiring nodes.

---

## Implementation change log

Append when implementation adds something **not** in locked sections above.

| Date | Branch | Decision | Owner OK |
| --- | --- | --- | --- |
| — | — | *(none yet)* | — |

```markdown
| YYYY-MM-DD | cursor/… | Description | yes/no |
```

---

## Quick checklist for agents

- [ ] Step matches slice A–E scope
- [ ] Tag skeleton has no extend/bind/logWarning
- [ ] Wiring uses node handles (G), not wire strings
- [ ] PlainFields exhaustive bind type tests in `*.test-d.ts`
- [ ] Calling API: builder → OperationContext
- [ ] No `defineEvent` / no kernel `stateRef` (Step 8+)
- [ ] Emit `R` never includes `RuntimeStorage`
- [ ] CHK items flagged, not silently assumed
- [ ] Change log updated if new decision introduced
- [ ] `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`
