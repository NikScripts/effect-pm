# Recipe: Telemetry split — bake session handoff

**Goal:** ~~Lock the full telemetry model before implementation~~ **Done (Jun 2026).** SSoT for implementation agents. Replace hub-branch interim APIs when slices land.

**Non-goals:** Implement slices in this session; transport work; dashboard UI.

**Owner prompt to start bake:** paste [telemetry-split-bake-prompt.md](../handoffs/telemetry-split-bake-prompt.md).

**Canonical vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md).

**Architecture (locked Jun 2026):** [architecture-split-and-transports.md](./architecture-split-and-transports.md).

**Golden telemetry tree (reference branch):** `origin/cursor/facet-telemetry-158c` —
`ProcessStore.telemetry` DSL in `runResource.ts` (port to `Telemetry.Tag`, not
on `*Store`).

**Current hub branch debt:** `src/store/RunResourceTelemetry.ts` uses `TelemetryHub.defineEvent`;
`RunResource.ts` owns telemetry counters in `Ref`; no `Telemetry.Service`, no registry,
no telemetry state module.

---

## Mise en place (repo facts)


| Area                                                | Shipped       | Wrong / missing                                                        |
| --------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `TelemetryHub` + sinks                              | Yes           | Hub used as event definition surface                                   |
| `ArchiveSink`, `ProjectionSink`, `BroadcastSink`    | Yes           | Legs wired to `defineEvent`, not tree                                  |
| `RunResourceStore` decoupled from telemetry section | Yes           | Hand-rolled codecs/wires                                               |
| `RunResourceProjection`                             | Yes           | —                                                                      |
| `State.Scope` + scopes                              | Partial       | RunResource kernel ignores `RunScope`                                  |
| `Telemetry.Tag` + `Telemetry.layer(tag)`           | **No**        | Bake locked — replace `defineEvent`                                    |
| `**Telemetry.registry`**                            | **No**        | Recipe step 2                                                          |
| **Telemetry state** (in-memory, telemetry-only)     | **No**        | Owner model — [plan 21](../plans/21-state-vocabulary.md)               |
| Plan 17 tree DSL on RunResource                     | **No** on hub | On `facet-telemetry-158c`                                              |
| Transport 6.4–6.6                                   | Merged to hub | —                                                                      |
| Domain folders under `store/`                       | Removed       | Flat PascalCase — [src-reorganization](../plans/src-reorganization.md) |


---

## Architecture principles (still apply — distinct from locked DX)

1. **Isolation / siloing** — opt-in subpaths, layers, registries; combined layers explicitly named.
2. **Three modules per domain** — telemetry tag, `*Store` (archive), `*Projection` (optional); separate tags.
3. **Emit `R = TelemetryHub`** at kernel sites — never `RuntimeStorage` on emit path.
4. **Telemetry tree DSL** — `Telemetry.Tag` with `namespace` / `group` / `operation` / `event`; **not** `defineEvent`.
5. **Hub = router only** — validate + fan-out; definitions live on `Telemetry.Tag`.
6. **Archive optional** — `ArchiveSink` leg; store facet queries only.
7. **Two in-memory state kinds** — process state (`State.Scope`) vs telemetry state (telemetry path only); see plan 21.
8. **Telemetry state never touches storage** — not projection, not durable ops.
9. **Role folders only** — `store/`, `sink/`, `transport/`; PascalCase files; no domain subfolders; no import shims.
10. **Reference implementation order** — restore RunResource telemetry from `facet-telemetry-158c` → hub bridge → Queue.
11. **Store/RPC separate** — `Procedure.payload().success().failure()` and `Store.Tag` are not telemetry APIs.

---

## Three APIs — locked (Jun 2026)

| # | API | Surface | Role |
| --- | --- | --- | --- |
| **1** | **`Telemetry.Tag`** | Class + tree DSL | **Skeleton only** — wires, schemas, ops, events. Generates **node handles** (G). |
| **2** | **Calling** | Static paths on Service | Builder → `{ input, telemetry, scope }` |
| **3** | **`Telemetry.Layer`** | `Telemetry.Layer.for(Tag)(…)` | **Wiring authored separately** — extend, bind, logWarning. **Not** on Tag. |
| **∴** | **`Telemetry.Service`** | `Telemetry.Service(Tag, Layer)` | **Tag + Layer** — what facets export from `store/*Telemetry.ts` |

**Internal** kernel/spine code does not import `Telemetry.Service`; it uses Service static paths when the Effect **`Service.layer`** is provided at compose.

### Tag vs Layer vs Service

| | **Tag** | **Layer** (API 3) | **Service** |
| --- | --- | --- | --- |
| Tree DSL | skeleton nodes only | wiring keyed by **node handles** | Tag + Layer merged |
| `Telemetry.extend` | — | ✓ | (from Layer) |
| `bind` (plain schema fields) | — | ✓ **required** where schema has plain `Schema.*` | (from Layer) |
| `logWarning` | — | ✓ optional per node | (from Layer) |
| `.layer` (Effect `Layer`) | — | — | ✓ on composed Service |

---

### Definition surface — `Telemetry.Tag` (**locked**, API 1)

Skeleton only. **No** extend, bind, logWarning. Tag factory generates **node handles** (G).

**On Tag:** namespace, group, operation, event, start, exit, scope ref, wire ids, node handles.

**Not on Tag:** extend, bind, logWarning → **`Telemetry.Layer`**. Effect runtime → **`Telemetry.Service.layer`**.

The Tag is **not** the facet definition for wiring — only the wire skeleton.

**On the Tag (API 1):**

- `Telemetry.namespace` / `Telemetry.group` / `Telemetry.operation` / `Telemetry.event`
- `Telemetry.operation<Input>(…)` — input type on **operation**
- `Telemetry.start(…)` / `Telemetry.exit(…)` — schema refs only, no binding args
- `State.Scope` reference as first child of each operation
- Wire ids derived from namespace + group + event name
- **Node handles** on Tag class — e.g. `RunResourceTag.Run.processEntry.Started`

**Not on Tag** → **`Telemetry.Layer`** (API 3):

- `Telemetry.extend`, `bind`, `logWarning`
- Effect **`Service.layer`** (from `Telemetry.Service(Tag, Layer)`)

- A telemetry tag may contain multiple `Telemetry.namespace(...)` blocks.
- `Telemetry.group(...)` replaces lowercase `Telemetry.tag(...)` to avoid collision with `Telemetry.Tag`.
- `Telemetry.group(...)` may not nest. Groups define the event wire path segment.
- Events may not live directly under a namespace; events live under a group or inside an operation nested in a group.
- Event wire ids are always `Namespace.Group.Event`. Operation names never contribute to event wire ids.

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
        }),
      ),
    ),
  ),
) {}
// Generated handles: RunResourceTag.Run.processEntry.Started, .Completed, .Failed
```

### Operations API — calling shape (agreed direction)

Mimic Effect: **function that returns `Effect`**, built with `pipe` / `flatMap` / `gen`.

```ts
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

When process already bracketed scope:

```ts
QueueEntryScope.run({ entryId: entry.id, attempts: entry.attempts },
  pipe(
    QueueResourceTelemetry.Entry.processEntry({ name: entry.name }).assumingLeaf(),
    Effect.flatMap((ctx) => …),
  ),
);
```

Nested no-input op (scope-inheriting):

```ts
yield* checkRateLimit.pipe(
  QueueResourceTelemetry.Entry.rateLimit,
  Effect.flatMap((ctx) => …),
);
```

Scope-free op:

```ts
yield* QueueResourceTelemetry.Backfill.reconcile({ fromSeq: 100, toSeq: 200 });
```

Rejected: extra `telemetry` callback param; bodies on `Telemetry.Tag`; two-arg `(leaf, input)`.

Optional shortcut (v2): `.gen(input, fn)` expanding pipe + flatMap.

---

### `start` and `exit`

- `Telemetry.start(name, event)` on tag declares start **event** only; input type on `Telemetry.operation<Input>`.
- Operations API: `processEntry(entry)` typed from `Telemetry.operation<QueueEntryInput>`.
- The **layer** emits the start event and opens scope using that input.
- `Telemetry.exit(…)` on the tag maps outcomes to group events; the **layer**
  emits them when the operation `Effect` completes — not the kernel manually.
- Middle events: zero-arg at call site; layer materializes from scope + telemetry state.
- How start/exit event **schemas** get their fields is a **layer** concern.

```ts
Telemetry.operation<QueueEntryInput>("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", QueueEntryStarted),
  Telemetry.exit({ … }),
);
```

---

### Telemetry state (layer — not on tag)

Telemetry state fields, reducers, scope extension, and entry cleanup belong in
the **layer** configuration — not in `Telemetry.Tag`.

```ts
// Illustrative — `Telemetry.extend` on Tag (API 1); runtime in API 3:
QueueResourceTelemetry.layer({
  state: {
    extend: [
      [QueueResourceScope, { depth: Telemetry.metric.gauge, inFlight: Telemetry.metric.gauge }],
      [QueueEntryScope, {
        enqueuedAt: Telemetry.metric.timestamp,
        startedAt: Telemetry.metric.timestamp,
        waitMs: Telemetry.metric.duration("enqueuedAt", "startedAt"),
      }],
    ],
  },
});
```

Exact `Telemetry.extend` runtime is API 3; the rule is **tag = definition, `Telemetry.layer(tag)` = behavior**.

### Store / procedure side decisions from this bake

- Rename the neutral procedure builder away from `ProcessStore` to `Procedure`.
- Keep the triplet chain: `Procedure.payload(Query).success(Result).failure(Error)`.
- `Store.Tag<Self>("ProcessTag")(id, procedures)` rejects resolved procedures.
- `Store.Service<Self>("ProcessTag")(id, procedures)` permits `.resolve(...)`.
- RPC-visible failures are `Schema.TaggedError` classes passed directly on contracts and round-trip through transport failure exits.
- Protocol failures are also `Schema.TaggedError` classes, but live in a shared transport error union separate from declared method failures.

### Module identity files

- Process/resource type identity should not be passed around as unrelated string
literals such as `"RunResource"` when the owning service tag cannot be imported
without circular dependencies.
- Domains that need shared identity across worker, telemetry, store facets, and
projections should get a small identity module:

```ts
export const TypeTag = "@nikscripts/effect-pm/RunResource";
export const TypeId: unique symbol = Symbol.for(TypeTag);
```

- Facets and telemetry definitions import the identity module, not the worker/service
module, when they only need the stable type id.

### Operations API — stress case (Queue `processEntry`, open)

See **Operations API — calling shape** above. Body bind location (layer vs module export) open.

### Telemetry layer — runtime platform (open)

Everything not on tag skeleton and not the calling `pipe`/`flatMap` shape. See
**Open questions (session handoff)** below for full checklist.

Do not put layer config on the `Telemetry.Tag` class body.

---

## Discussion log (Jun 2026 bake sessions)

Chronological notes from owner + bake sessions. Use this to resume context.

### Jun 2026 — Third API: `Telemetry.layer(tag)` not `Telemetry.Service` (owner)

Package code (facets + internal) uses **`Telemetry.Tag`** for the full definition tree
and **`Telemetry.layer(tag)`** for runtime. **`Telemetry.Service` rejected** — duplicates
Tag + layer; not used internally. Runtime implementation lives in **`src/internal/telemetry/`**.

### Jun 2026 — Service DX correction (owner)

Owner rejected flat `events` / `operations` config. Definition stays **Tag-shaped tree**
with optional additions on the same nodes (`Telemetry.start(…, bindings)`,
`Telemetry.extend(scope, …)`, `.pipe(Telemetry.logWarning(…))`).

### Jun 2026 — Tag bindings + logWarning (owner)

- **`Telemetry.extend(scope, { … })`** — locked as shown.
- **Event bindings (3rd arg)** — required for plain `Schema.*` fields only; scope / terminal / literal auto.
- **`Telemetry.logWarning`** — **pipe** on event node on the **Tag** definition:

```ts
Telemetry.event("Changed", RunResourceStateChanged).pipe(
  Telemetry.logWarning(
    "RunResourceStore write failed for state change",
    ({ reason }) => ({ reason: String(reason) }),
  ),
),
```

Callbacks receive the **materialized event row**.

---

### Process scope vs telemetry state vs operation input

Three **separate concepts**. Do not merge operation input into scope or events automatically.

| Concept | What it is | Visible to process? | Auto for telemetry events? |
| --- | --- | --- | --- |
| **Process scope state** | Identity + process fields in `State.Scope` context | Yes | Yes — events bind scope fields (selectors / materialization) |
| **Telemetry state** | **Same scope object** as process state, extra fields added by telemetry layer | **No** (hidden) | Yes — when layer extends scope |
| **Operation input** | Explicit payload to operation call (`processEntry(…)`) | N/A | **No** — never auto-merged into scope or events |

- Process runs fine **without** telemetry layer; telemetry adds hidden fields on top of the same scope.
- If a value is **already in scope** (because kernel put it there via `Scope.run` / lifetime provide), **do not** pass it again as operation input — telemetry picks it up from scope.
- Operation input is for telemetry-specific data **not** in scope.
- **Operation input is not related to scope.**

**Implementation API** receives operation input at op start and **explicitly** decides per configuration: write to telemetry state, include in an event, add to log annotations, or ignore. No automatic routing.

---

### Tag skeleton decisions

**Input type on operation, not on `Telemetry.start`:**

```ts
Telemetry.operation<QueueEntryInput>("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", QueueEntryStarted),
  Telemetry.exit({ … }),
  …
);
```

`Telemetry.start` declares the start **event** only. Input type lives on `Telemetry.operation<Input>`.

**Operation input type may differ from function arg type:**

```ts
// Function processes full entry; telemetry input is explicit subset
const processEntry = (entry: { id: number; name: string; component: ReactNode }) =>
  pipe(
    QueueResourceTelemetry.Entry.processEntry({ name: entry.name }),
    Effect.flatMap((ctx) => Effect.gen(function* () {
      yield* ctx.telemetry.Retried;
      return yield* processItem(entry);
    })),
  );
```

Telemetry does **not** get implicit access to function args — only scope (auto) and operation input (explicit).

**Scope is declared on the operation in the tag** (`QueueEntryScope` as first child). Call sites should not need a redundant outer `QueueEntryScope.run` **if** the operation opens scope — but **how** is open (see rejected / explore below).

**Exit-only operation shorthand** (owner proposal):

```ts
Telemetry.operation("rateLimit")({
  onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
  onSuccess: Telemetry.event("Accepted", QueueRateLimitAccepted),
});
// overload when only exit mapping, no start, no child events/ops
```

**Nested operations inherit parent scope** when no scope child specified:

```ts
Telemetry.operation<QueueEntryInput>("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", QueueEntryStarted),
  Telemetry.operation("rateLimit")({
    onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
  }),
  …
);
```

`rateLimit` uses parent op's active scope — no second scope declaration.

---

### Calling API direction (owner)

Mimic Effect — function returning `Effect`, `pipe` / `flatMap` / `gen`:

```ts
const processEntry = (entry: QueueEntryInput) =>
  pipe(
    QueueResourceTelemetry.Entry.processEntry(entry),
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

- `processEntry(input)` — first step; opens operation; returns `Effect` to continue.
- `ctx` shape open — likely includes `telemetry` handle for nested ops / middle events.
- Shortcuts (`.gen`) optional later.
- **Rejected:** extra `telemetry` callback param on generator; `.gen(entry, telemetry)` draft; bodies on `Telemetry.Tag`.

---

### Scope at call site — rejected approach

Because scope is on the tag operation, avoid:

```ts
QueueEntryScope.run({ entryId, attempts },
  pipe(QueueResourceTelemetry.Entry.processEntry({ name: entry.name }), …),
);
```

**Also rejected (owner):** passing scope leaf as separate first arg:

```ts
QueueResourceTelemetry.Entry.processEntry(
  { entryId: entry.id, attempts: entry.attempts }, // scope leaf
  { name: entry.name },                            // operation input
);
```

**Next topic to explore:** how operations open/update scope — from **leaf** vs from **root**; patterns for each. See § Scope opening strategies below.

---

### Calling API — scope builder (agreed Jun 2026)

**Leading call shape:** operation input first, scope via chained provider (names TBD — `provideLeaf` / `provideRoot` preferred over `setLeaf`):

```ts
const processEntry = (entry: FullEntry) =>
  pipe(
    QueueResourceTelemetry.Entry.processEntry({ name: entry.name })
      .provideLeaf({ entryId: entry.id, attempts: entry.attempts }),
    Effect.flatMap((ctx) =>
      Effect.gen(function* () {
        yield* ctx.telemetry.Retried;
        return yield* processItem(entry);
      }),
    ),
  );
```

`processEntry(input)` returns a **builder** when the tag declares scope; **not** an `Effect` until scope obligation is satisfied.

#### Three operation kinds

| Kind | Scope on tag | Call shape |
| --- | --- | --- |
| **Scope-required** | Leaf and/or root declared | `op(input).provideLeaf(…)` / `.provideRoot(…)` / `.assumingLeaf()` / `.assumingRoot()` → `Effect` |
| **Scope-inheriting** | No scope child (nested under scoped parent) | `op` or `op(input)` → `Effect`; may read inherited context for events |
| **Scope-free** | No scope child (top-level) | `op(input)` → `Effect` immediately; no provider chain |

Exit-only nested ops (e.g. `rateLimit`) — scope-inheriting; no `provideLeaf`.

#### Satisfying scope on the builder (no type error)

Builder must complete via **one** of:

- **`provideLeaf(leaf)`** — explicit `QueueEntryScope.Leaf` (typed from tag)
- **`provideRoot(root)`** — when root not ambient; may chain before `provideLeaf`
- **`assumingLeaf()` / `assumingRoot()`** — scope already in `R` (process bracketed via `Scope.run` / lifetime layer)

**Type error** only when: tag declares scope, scope is **not** ambient, and builder never completes with one of the above → cannot obtain `Effect`.

**Not** satisfied by: mid-op `patch` / nested scope alone (those run **after** scope is established).

#### Process vs telemetry scope setup

- Kernel may establish scope **before** the op (`QueueEntryScope.run` + `.assumingLeaf()`) — process owns values; telemetry documents via `assuming*`.
- Or telemetry builder **`provideLeaf`** when kernel passes values at op boundary.
- Operation input remains **separate** — never auto-merged into scope.

#### Mid-operation scope changes (after initial obligation met)

| Need | Mechanism |
| --- | --- |
| Patch fields on current leaf | `Scope.patch` (process) — TBD on `State.Scope` |
| Telemetry-only hidden fields | Layer reducers on emit — not kernel patch |
| New sub-context | Nested `Scope.run` / nested op — not parent patch |
| Values unknown at op entry | Split ops, defer start emit, or process bracket before op — **not** “builder completes without scope” |

#### Root vs leaf on builder

- Tag declares **leaf** → typically `provideLeaf`; root ambient from queue lifetime unless `.provideRoot({ queueId })`.
- Tag declares **root** only (e.g. lifecycle) → `provideRoot`.
- **`provideRoot` before `provideLeaf`** when both explicit.

---

### OperationContext (agreed — option C hybrid)

What `Effect.flatMap` receives after the builder completes:

```ts
interface OperationContext<
  Input,
  ScopeState,      // process-visible scope view (typed from op's declared scope)
  TelemetryHandle,
> {
  readonly input: Input;
  readonly telemetry: TelemetryHandle;
  readonly scope: ScopeState;   // live view — same Context provideLeaf opened; not a snapshot
}
```

- **`input`** — operation input from `op(input)`; **not** from scope.
- **`telemetry`** — child event/op shortcuts (`Retried`, `rateLimit`, …).
- **`scope`** — read process-visible fields (`ctx.scope.entryId`); backed by active scope Context.
- **Telemetry hidden fields** — same runtime object; **not** on process `ScopeState` type.
- **Mutate scope mid-op** — `yield* QueueEntryScope.patch({ … })` (or alias on `ctx`); **does not** replace `provideLeaf`.

**Builder still required** when tag declares scope: `provideLeaf` / `provideRoot` / `assuming*` before `Effect`. **`patch`** only updates existing scope inside the body.

```ts
Effect.flatMap((ctx) =>
  Effect.gen(function* () {
    yield* ctx.telemetry.Retried;
    ctx.input.name;
    ctx.scope.entryId;
    yield* QueueEntryScope.patch({ startedAt: now });
  }),
);
```

---

### Scope providers — naming (proposed lock)

| Method | Meaning |
| --- | --- |
| **`provideLeaf(leaf)`** | Open/install leaf scope on this op (`Scope.Leaf` type from tag) |
| **`provideRoot(root)`** | Open/install root when not ambient |
| **`assumingLeaf()`** | Leaf already in `R`; builder completes without install |
| **`assumingRoot()`** | Root already in `R` |

**Explicit `assuming*` over inference** — no magic ambient detection in v1 ( clearer errors; add inference later if noisy).

Builder types (conceptual):

```ts
type OpBuilder<Input, Needs extends "leaf" | "root" | "none"> =
  Needs extends "none" ? Effect<OperationContext<Input, …>, …>
  : { provideLeaf(…): …; assumingLeaf(): Effect<…>; … }
```

---

### `State.Scope.patch` (proposed)

Process-visible mid-op updates on **current** scope level:

```ts
yield* QueueEntryScope.patch({ attempts: scope.Entry.attempts + 1 });
// or partial update API on yielded state shape
```

Rules:

- **Process code** may patch process-visible fields only (type-enforced vs telemetry hidden fields).
- **Telemetry layer** may patch hidden fields via reducers on emit — not from kernel.
- Patch does **not** replace builder obligation at op start.
- Implementation: Ref-backed scope service or `FiberRef` — bake implementation detail; API on scope tag.

---

---

## API 3 — `Telemetry.Layer` (**locked**, Jun 2026)

**Authoring API for everything Tag omits.** Created **separately** from Tag.  
**`Telemetry.Service(Tag, Layer)`** = Tag + Layer. Effect **`Service.layer`** activates runtime (implementation in `src/internal/telemetry/`).

Owner pick: **G (node handles) + E (nested `nodes` map)** with **exhaustive bind** for plain `Schema.*` fields.

### Entry point

```ts
export const RunResourceLayer = Telemetry.Layer.for(RunResourceTag)({
  extend: {
    [RunScope]: {
      waiting: Telemetry.metric.gauge,
      inFlight: Telemetry.metric.gauge,
    },
  },
  nodes: {
    [RunResourceTag.Run.processEntry.Started]: {
      bind: {
        name: Operation.input("name"), // required — plain field on RunResourceRunStarted
      },
    },
    [RunResourceTag.Run.processEntry.exit.onFailure]: {
      logWarning: Telemetry.logWarning(
        "RunResourceStore write failed for run failure",
        ({ runId }) => ({ runId: String(runId) }),
      ),
    },
    // nodes with only scope/terminal/literal fields: omit or `{}`
  },
})

export const RunResourceTelemetry = Telemetry.Service(RunResourceTag, RunResourceLayer)
// RunResourceTelemetry.layer — Effect Layer (requires TelemetryHub)
```

### Node handles (G)

Tag factory generates **`EventNode<Schema>`** handles on the Tag class:

```ts
RunResourceTag.Run.processEntry.Started   // EventNode<typeof RunResourceRunStarted>
RunResourceTag.Run.processEntry.Completed
RunResourceTag.Run.Started
```

Layer **`nodes`** map is keyed by these handles — not wire strings.

### Type enforcement

From each event schema (`Telemetry.Schema`), compute **`PlainFields<Schema>`** — keys whose fields are plain `Schema.*` (not scope-bound, not `Telemetry.terminal.*`, not literal).

| Schema field kind | Layer `bind` |
| --- | --- |
| Scope-bound (`QueueEntryState.Entry.entryId`) | **Omit** — auto at materialize |
| Terminal / literal | **Omit** — auto |
| Plain `Schema.*` | **Required** in `bind` for that node |

```ts
type LayerNodeConfig<Schema> = PlainFields<Schema> extends never
  ? { logWarning?: TelemetryLogWarningConfig }
  : {
      bind: { [K in PlainFields<Schema>]: FieldSource }
      logWarning?: TelemetryLogWarningConfig
    }
```

**Exhaustiveness:** `Telemetry.Layer.for(Tag)(config)` must include a `nodes` entry (or inferred empty config) for **every** `EventNode` on Tag that has `PlainFields` ≠ never. Missing node → **type error**.

Optional: **`logWarning`** on any node regardless of plain fields.

**Field sources:** `Operation.input`, `Exit.value` / `Exit.cause` / `Exit.durationMs`, `Clock.now`, `Telemetry.state`.

### `extend`

Top-level **`extend`** on Layer config (same as prior bake): scope → hidden telemetry metric fields.

### Service compose

```ts
Telemetry.Service(tag, layerDef) → {
  // merged definition for runtime + calling static paths
  layer: Layer<TelemetryHub>,  // no-op paths when not provided
  …Tag static paths (Entry.processEntry, …)
}
```

Registry, emit pipeline, operation runner — **implementation** of `Service.layer`; not part of Layer authoring API.

### Rejected for API 3

- Mirror full Tag tree in Layer (A)
- Flat wire-string map (B)
- Attach combinators only (C/F)
- Bindings on Tag skeleton

---

### Exit-only operation overload (proposed lock)

```ts
Telemetry.operation("rateLimit")({
  onSuccess: Telemetry.event("Accepted", QueueRateLimitAccepted),
  onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
});
```

Equivalent to `Telemetry.operation("rateLimit")(Telemetry.exit({ … }))` with no scope child, no start, no middle events. Scope-inheriting when nested.

---

### End-to-end Queue `processEntry` (target)

**Tag definition (API 1):**

```ts
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
);
```

**Kernel:**

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

**Tag binds** `Started.name ← Operation.input("name")` on the **same** `Telemetry.start(…)` node; scope fields omitted when schema + scope cover them.

---

### `logWarning` on Tag (locked)

```ts
Telemetry.event("Changed", RunResourceStateChanged).pipe(
  Telemetry.logWarning(
    "RunResourceStore write failed for state change",
    ({ reason }) => ({ reason: String(reason) }),
  ),
),
```

Declared on **`Telemetry.Tag`** tree; executed by runtime (API 3) on archive persist failure.

---

### How scope works today (repo reference)

`State.Scope` (`src/State.ts`): nested Context service; `withLeaf` builds tree; `run(leaf, effect)` / `layer(leaf)` / `provide(leaf)`.

Queue today (`QueueResource.ts`, tests):

```ts
QueueResourceScope.run({ queueId },
  QueueEntryScope.run({ entryId },
    Effect.gen(function* () {
      yield* QueueResourceStore.Entry.Started({ /* manual payload — debt */ });
    }),
  ),
);
```

Event schemas (`queueResourceTelemetry.ts`) bind fields via scope selectors e.g. `QueueEntryState.Entry.entryId`. **Target:** zero-arg emit reads scope; kernel stops hand-building payloads.

Plan 18 patterns: lifetime **A** (root on factory), **B** (leaf provide on unit), **D** (`WorkerScope.run` on fiber). Queue target: `QueueResourceScope` on runtime; `EntryScope` per entry execution.

---

### Scope opening strategies (reference — superseded by agreed builder rules above)

See **Calling API — scope builder (agreed Jun 2026)** for locked rules. Remaining open: exact names, `.assuming*` vs ambient inference, `Scope.patch` API on `State.Scope`.

| Strategy | Status |
| --- | --- |
| Builder `provideLeaf` / `provideRoot` | **Agreed** leading shape |
| `assumingLeaf` / `assumingRoot` | **Agreed** when process already bracketed |
| Ambient root + explicit leaf on builder | **Agreed** default for Queue `processEntry` |
| Separate two-arg `(leaf, input)` | Rejected |
| Outer `Scope.run` + op only | OK as **process** bracket + `.assumingLeaf()` |
| Mid-op scope without initial obligation | Rejected |

---

## Open questions (session handoff)

**Bake closed (Jun 2026).** All decisions live in **Open recipe steps** (steps 1–9, locked) and **Deferred to implementation**. Return here only to revise a lock.

**Branch:** `cursor/telemetry-redesign-bake-faed` · **Plan:** [20](../plans/20-process-store-split-and-telemetry.md) · **Vocabulary:** [21](../plans/21-state-vocabulary.md)

### Quick reference — all locked

- **Tag (API 1):** full tree — `extend`, bindings, `.pipe(logWarning)` on `Telemetry.Tag`
- **Layer (API 3):** `Telemetry.Layer.for(Tag)({ extend, nodes })` — G handles + exhaustive bind
- **Calling (API 2):** builder → `{ input, telemetry, scope }` live view
- **Registry:** `Telemetry.registry([...])` at compose
- **Emit:** materialize → metrics → hub → sinks; runner owns start/exit
- **RunResource:** counters → telemetry state; delete `stateRef`
- **Deferred:** `Scope.patch` internals, `.gen`, tracers, strict `Operation.input` keys

### I. Store/RPC (separate track — not telemetry bake)

- [ ] `Procedure` + `Store.Tag` / `Store.Service` — decided; implement when?
- [ ] Effect RPC under store transport (plan 16)

---

## Open recipe steps (bake in order)

Steps 1–9 **locked**. Three APIs: **Tag** (definition) · **Calling** · **`Telemetry.layer(tag)`** (runtime).

### Step 1 — `Telemetry.Tag` definition (**locked**, API 1)

**Decides:** Public facet definition — tree + extend + bindings + logWarning; no runtime.

**Locked shape:** see **Definition surface** and **Three APIs** above.

**Acceptance:** `store/*Telemetry.ts` extends `Telemetry.Tag` only; golden tree from
`facet-telemetry-158c` ports with extend/bindings as needed.

---

### Step 2 — Calling API (**locked**, API 2)

Canonical shape, builder, OperationContext — see **Calling API — scope builder** and **OperationContext (agreed)**.

**Acceptance:** Queue `processEntry` stress case; `provideLeaf` + `patch` + `ctx.scope` live view.

---

### Step 3 — `Telemetry.Layer` (API 3) (**locked**)

`Telemetry.Layer.for(Tag)({ extend, nodes })`. Service = `Telemetry.Service(Tag, Layer)`.

---

### Step 4 — `Telemetry.registry` (**locked**)

```ts
Layer.provideMerge(
  Telemetry.registry([RunResourceTelemetry, QueueResourceTelemetry]),
)
```

| Decision | v1 lock |
| --- | --- |
| Registration | **Explicit compose** — `Telemetry.registry([...tags])` returns a **Layer** |
| Timing | Layer build — **not** module import side effects |
| Scope | **`Telemetry.Tag`** definitions only — **`ProcessStore.registry`** = archive facets |
| Sink matching | By **wire id** from registry catalog |
| Global singleton | **Rejected** — per-compose registry layer |

---

### Step 5 — Telemetry state API (**locked**)

| Decision | v1 lock |
| --- | --- |
| Storage | **Same object** as process scope; process types exclude hidden fields |
| Declaration | **`Telemetry.extend(scope, fields)`** on Tag tree |
| Metric kinds v1 | `gauge`, `counter`, `timestamp`, `duration(from, to)` |
| Lifetime | Worker / domain compose scope — in-memory only |
| Writers | Metrics leg + operation runner — **kernel never reads/writes telemetry state** |
| Reducers v1 | Counter bumps on configured **exit wires** only |
| **Entry cleanup** | Drop entry-scoped hidden fields when op **exit** completes |
| Snapshot API | **`@internal` v1** |
| Durable storage | **Never** `RuntimeStorage` |

---

### Step 6 — Hub emit bridge (**locked**)

```text
yield* handle.Event
  1. resolve scope + OperationContext
  2. materialize: schema + Tag bindings + Exit.* / op input
  3. optional metrics leg → telemetry state
  4. validate payload
  5. TelemetryHub.emit
  6. sinks fan-out (failures isolated per sink)
```

| Decision | v1 lock |
| --- | --- |
| Start / exit | **Operation runner** emits |
| Middle events | **`yield* ctx.telemetry.*`** on handle |
| Wire ids | **`Telemetry.Wire<typeof Tag>`** — no raw strings in kernel |
| Correlation | From **scope** only |
| Emit `R` | **None** (stub) or **`TelemetryHub` only** — never store |
| Archive | **`ArchiveSink`** — not inline in emit |
| `logWarning` | Persist fail → log + **swallow** (existing behavior) |

---

### Step 7 — RunResource kernel boundary (**locked**)

| Process | Telemetry |
| --- | --- |
| `Semaphore`, user effect, scopes | `waiting`, `inFlight`, `completed`, `failed`, `interrupted`, `totalDurationMs`, `configVersion` |
| | `State.Changed` from telemetry state snapshot |

- **Delete** kernel `stateRef` when telemetry layer ships.
- **Gating = semaphore only.**

---

### Step 8 — Layer matrix (**locked**)

**Decides:** Default exports for apps; naming.


| Layer                                  | Requires           | Provides                       |
| -------------------------------------- | ------------------ | ------------------------------ |
| `TelemetryHub.layer`                   | —                  | emit                           |
| `Telemetry.layer(RunResourceTelemetry)` | hub                | state + operations API + emit bridge |
| `RunResourceStore.layerRuntimeStorage` | `RuntimeStorage`   | queries                        |
| `ArchiveSink.layerForStore(...)`       | storage + hub      | persist leg                    |
| `RunResourceProjection.layerLive`      | hub                | live read                      |
| `RunResourceCompose.layerPersist`      | **explicit merge** | convenience                    |


**Acceptance:** Table is v1 default; no monolithic layer pulls all facets without explicit compose name.

---

### Step 9 — Migration & delete list (**locked**)

**Decides:** What dies on hub branch when bake closes.

**Delete / replace:**

- `TelemetryHub.defineEvent` usage in facet modules
- `RunResourceHubTelemetry` namespace
- Hand-duplicated wire const arrays in `RunResourceStore` / `RunResourceTelemetry`
- Kernel `Ref` counters (after telemetry state)
- Docs referencing `store/runResource/` folders, transport-only parallel agent as primary path

**Keep:**

- `TelemetryHub`, sink modules, projection pilot, transport merge, flat `store/RunResource*.ts`

**Acceptance:** Delete list is approved for post-bake migration slices.

---

### Module layout & minor confirms (**locked**)

| Item | v1 lock |
| --- | --- |
| Telemetry facet file | `store/<Domain>Telemetry.ts` — **`Telemetry.Tag`** tree |
| Tag catalog | Tag class is registry source — no separate Service extract |
| Identity module | `src/<Domain>Identity.ts` — `TypeTag`, `TypeId`; facets import identity, not worker |
| Subpath | `store/<Domain>Telemetry` for Service; identity at `@nikscripts/effect-pm/<Domain>Identity` |
| `Telemetry.operation<Input>` | Input type param on **operation** — locked |
| `Scope.patch` | `yield* QueueEntryScope.patch(partial)` — process-visible fields only; Ref impl deferred |
| `Operation.input("key")` typing | Best-effort v1 — strict key enforcement deferred |

---

### Deferred to implementation (not blocking bake)

| Item | Default / note |
| --- | --- |
| `Scope.patch` Ref + hidden-field type firewall | Implementation detail |
| `.gen(input, fn)` shortcut | v2 |
| Tracer spans at op boundaries | v2 — wire `${typeId}/op/path` |
| Telemetry state → Effect `Metric` bridge | v2 |
| Test capture layer for emit assertions | Implement with Slice C |
| General reducer DSL beyond exit-wire counters | v2 |
| `prepare` pipe leg (plan 17 phase 2) | After metrics leg ships |
| Store/RPC `Procedure` migration | Separate from telemetry slices |

---

## Rejected substitutions (record during bake)


| Proposal                                          | Reason                                 |
| ------------------------------------------------- | -------------------------------------- |
| `defineEvent` as SSoT                             | Bypasses plan 17 DSL; caused hub drift |
| Durable `ProcessStore.state` as “telemetry state” | Wrong vocabulary — ops storage         |
| Domain folders under `store/`                     | Owner: role folders only               |
| Flat `events` / `operations` maps on Service | Duplicates Tag tree; terrible authoring DX — use same tree + optional bindings |
| `logWarning` inside binding 3rd arg | Use `.pipe(Telemetry.logWarning(…))` on event node — matches existing facet DSL |
| **`Telemetry.Service`** | Rejected — use **`Telemetry.Tag`** + **`Telemetry.layer(tag)`** |
| Operation bodies / handlers on Tag class | Runtime in API 3 — operation runner in `internal/telemetry` |
| Telemetry state Refs on Tag class | **`Telemetry.extend`** on Tag; Refs in API 3 runtime |
| `Telemetry.layer(Tag, config)` with second config object | Tag tree is SSoT — **`Telemetry.layer(tag)`** only |
| Global telemetry registry singleton | Per-compose `Telemetry.registry([...])` Layer |
| Module import registry side effects | Explicit Layer at compose |


---

## Bake finish line — **closed** (Jun 2026)

All steps 1–9 locked. Implementation agents may start slices; owner review welcome but not blocking.

### Locked summary

| Area | Lock |
| --- | --- |
| **API 1 Tag** | Full tree — namespace / group / operation / event / extend / bindings / logWarning |
| **API 2 Calling** | Builder + `{ input, telemetry, scope }` + `provideLeaf` / `assuming*` |
| **API 3 Layer** | `Telemetry.Layer.for(Tag)` + `Telemetry.Service(Tag, Layer)` |
| Registry | `Telemetry.registry([...tags])` at compose |
| State | Hidden fields via `extend`; entry cleanup on op exit |
| Emit | materialize → metrics → validate → hub → sinks |
| RunResource | Counters off kernel `Ref`; gating = semaphore |
| Layout | `store/*Telemetry.ts` = Tag; `src/*Identity.ts` |
| Delete | `defineEvent`, `RunResourceHubTelemetry`, kernel `stateRef`, duplicate wire consts |

### Implementation slices (for other agents)

| Slice | Deliverable |
| --- | --- |
| **A** | `Telemetry.Tag` factory + RunResource Tag port (`facet-telemetry-158c`) |
| **B** | Calling API + `Telemetry.layer(tag)` stub + OperationContext |
| **C** | `internal/telemetry` runtime — materialize, emit, operation runner, extend |
| **D** | Registry + ArchiveSink wiring; delete `defineEvent` on RunResource |
| **E** | Queue migration (separate branch) |

Update [21-state-vocabulary.md](../plans/21-state-vocabulary.md) when bake closes.

---

## After bake — implementation handoff

1. Update plan 21 with locked outcomes.
2. Slice A: `Telemetry.Tag` factory + RunResource Tag port.
3. Slice B: Calling API + `Telemetry.layer(tag)` + OperationContext.
4. Slice C: `internal/telemetry` runtime + hub bridge + `Scope.patch` + extend.
5. Slice D: registry + RunResource hub bridge + delete `defineEvent`.
6. Slice E: Queue on separate branch.

**Verification (every slice):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

**Changeset:** required before merge to integration branch (owner approval).

---

## Bake session checklist

- [x] Step 1 — `Telemetry.Tag` definition (API 1) locked
- [x] Step 2 — Calling API (API 2) locked
- [x] Step 3 — `Telemetry.Layer` (API 3) locked
- [x] Step 4 — registry v1
- [x] Step 5 — telemetry state + entry cleanup
- [x] Step 6 — hub bridge flow
- [x] Step 7 — RunResource kernel boundary
- [x] Step 8 — layer matrix
- [x] Step 9 — delete list
- [x] Plan 21 updated
- [x] Bake closed — ready for implementation slices

