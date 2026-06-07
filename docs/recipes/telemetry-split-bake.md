# Recipe: Telemetry split — bake session handoff

**Goal:** Lock the full telemetry / archive / projection / state model before more
implementation. Fix vocabulary drift and replace hub-branch interim APIs (`defineEvent`,
`RunResourceHubTelemetry`) with the agreed design.

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
| `**Telemetry.Service`**                             | **No**        | Plan 20 target                                                         |
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

## Telemetry redesign current locks (supersedes stale steps below)

**Only the `Telemetry.Tag` skeleton DX is locked.** Two **additional** APIs are
still open — do not conflate them:

| API | Lives on | Status | Purpose |
| --- | --- | --- | --- |
| **`Telemetry.Tag`** | Tag class | **Locked** | Skeleton contract only: namespaces, groups, operations, events, scopes, `start` / `exit` declarations |
| **Operations API (calling)** | Operation handles from tag + layer | Open | `(input) => pipe(processEntry(input), Effect.flatMap, gen)` + shortcuts |
| **Telemetry layer** | `Layer` | Open | Everything else telemetry does: state, scope extension, hub bridge, registry, emit materialization, operation wrappers |

**Tag stays light.** Do not put telemetry state, handlers, registry, or emit
plumbing on the tag. The layer owns runtime behavior; the operations API owns
how kernel code **enters** a tracked operation with the right input type.

`Procedure.payload().success().failure()` belongs to **`Store.Tag` / RPC only**.
Telemetry vocabulary: **`namespace`**, **`group`**, **`operation`**, **`event`**.
Wire ids: **`Namespace.Group.Event`**. Operations use **`Telemetry.start`** /
**`Telemetry.exit`** — not Procedure selectors.

---

### Definition surface — `Telemetry.Tag` skeleton (locked)

The tag is a **skeleton** only. It declares shape — not runtime behavior.

**On the tag:**

- `Telemetry.namespace` / `Telemetry.group` / `Telemetry.operation` / `Telemetry.event`
- `Telemetry.operation<Input>(…)` — input type on **operation** (leading candidate; not locked)
- `Telemetry.start(…)` / `Telemetry.exit(…)` declarations — no type param on start
- `State.Scope` reference as first child of each operation
- Wire ids derived from namespace + group + event name

**Not on the tag** (layer or operations API instead):

- Telemetry state fields and reducers
- Operation bodies / handlers
- Hub emit bridge, registry, scope-field merging
- Generated `(input) => Effect` runners (operations API — see below)

- `Telemetry.Service` is optional convenience only; built-in package code should not rely on it.
- A telemetry tag may contain multiple `Telemetry.namespace(...)` blocks.
- `Telemetry.group(...)` replaces lowercase `Telemetry.tag(...)` to avoid collision with `Telemetry.Tag`.
- `Telemetry.group(...)` may not nest. Groups define the event wire path segment.
- Events may not live directly under a namespace; events live under a group or inside an operation nested in a group.
- Event wire ids are always `Namespace.Group.Event`. Operation names never contribute to event wire ids.

```ts
class QueueResourceTelemetry extends Telemetry.Tag<QueueResourceTelemetry>(
  "@nikscripts/effect-pm/store/QueueResource/QueueResourceTelemetry",
)(
  Telemetry.namespace("Queue")(
    Telemetry.group("Entry")(
      Telemetry.operation<QueueEntryInput>("processEntry")(
        QueueEntryScope,
        Telemetry.start("Started", QueueEntryStarted),
        Telemetry.event("Retried", QueueEntryRetried),
        Telemetry.operation("rateLimit")(
          QueueEntryScope,
          Telemetry.event("Exceeded", QueueRateLimitExceeded),
          Telemetry.exit({
            onSuccess: Telemetry.event("Accepted", QueueRateLimitAccepted),
            onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
          }),
        ),
        Telemetry.exit({
          onSuccess: Telemetry.event("Completed", QueueEntryCompleted),
          onFailure: Telemetry.event("Failed", QueueEntryFailed),
          onInterrupt: Telemetry.event("Released", QueueEntryReleased),
        }),
      ),
    ),
    Telemetry.group("Lifecycle")(
      Telemetry.event("Started", QueueLifecycleStarted),
      Telemetry.event("Paused", QueueLifecyclePaused),
      Telemetry.event("Resumed", QueueLifecycleResumed),
      Telemetry.event("Drained", QueueLifecycleDrained),
      Telemetry.event("Shutdown", QueueLifecycleShutdown),
    ),
  ),
) {}
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
// Illustrative — lives on layer config, not tag skeleton:
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

Exact layer config shape is open; the rule is **tag = skeleton, layer = behavior**.

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

### Three APIs (do not conflate)

| API | Role |
| --- | --- |
| **`Telemetry.Tag`** | Skeleton only: namespace, group, operation, event, scope ref, `Telemetry.operation<Input>`, `start` / `exit` |
| **Calling API** | How kernel runs an operation — Effect-native (`pipe`, `flatMap`, `gen`); passes operation input |
| **Implementation API** | Not designed yet — handles operation input routing, scope materialization, logWarning, telemetry state reducers, layer; likely **`Telemetry.Service`** (tag + implementation together) |

`Procedure.payload().success().failure()` is **Store/RPC only**, not telemetry.

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

### Implementation API — field sources (proposed)

Lives on **`Telemetry.Service`** (tag + wiring together). Event schemas declare fields; **sources** bind at implementation time.

| Source | Use |
| --- | --- |
| **`Scope.field(path)`** | Auto from active scope (successor to `QueueEntryState.Entry.entryId`) |
| **`Operation.input(key)`** | Explicit from operation input — **only where bound** |
| **`Exit.value`** / **`Exit.cause`** | Exit events |
| **`Exit.durationMs`** | Exit events |
| **`Clock.now`** | `occurredAt` |
| **`Telemetry.state(path)`** | Hidden scope fields / reducers |
| **`Log.annotation(…)`** | Structured log — not event payload |

Example on Service (shape illustrative):

```ts
class QueueResourceTelemetry extends Telemetry.Service<QueueResourceTelemetry>(…)({
  tag: /* Telemetry.Tag skeleton */,
  events: {
    "Queue.Entry.Started": {
      fields: {
        entryId: Scope.field("Entry", "entryId"),
        name: Operation.input("name"),           // from op input — explicit
        occurredAt: Clock.now,
      },
      logWarning: {
        message: "…",
        annotations: (ctx) => ({ entryId: String(ctx.scope.Entry.entryId) }),
      },
    },
  },
  operations: {
    processEntry: {
      input: { name: Schema.String },
      scope: QueueEntryScope,
      start: "Started",
      exit: { onSuccess: "Completed", onFailure: "Failed", onInterrupt: "Released" },
    },
  },
  state: { … },
}) {}
```

**No automatic** `Operation.input` → scope or → all events. Each field names its source.

Operation input routing to **telemetry state** or **logs only** — same explicit map; omit from event fields if unused.

---

### `Telemetry.Service` vs `Telemetry.Tag` (proposed)

| Export | Contents |
| --- | --- |
| **`QueueResourceTelemetry` tag class** | Skeleton only — importable without layer deps |
| **`QueueResourceTelemetry` Service** | Tag + `events` sources + `operations` wiring + `state` + `.layer` |
| **Generated handles** | `Entry.processEntry`, `Entry.rateLimit`, … from skeleton |

Apps / facets import **Service** when authoring; transport/registry import **Tag** for wire catalog.

File layout (proposal):

```text
store/QueueResourceTelemetry.ts      — Telemetry.Service (compose)
store/QueueResourceTelemetryTag.ts — Telemetry.Tag skeleton only (optional split)
```

Or single file exporting both if Service extends Tag class.

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

**Tag skeleton:**

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

**Service binds** `Started.name ← Operation.input("name")`, `Started.entryId ← Scope.field(…)`, etc.

---

### `Telemetry.Service` (implementation API sketch)

Tag alone is not enough — skeleton is used to build the facet **and** the wiring API.

- **`Telemetry.Tag`** — importable contract; no handlers, no state config, no input routing.
- **`Telemetry.Service`** (name TBD) — define tag skeleton + implementation together: input routing, scope extension, logWarning, layer, generated operation handles.

Old DX (outdated placement, keep behavior on implementation side):

```ts
Telemetry.event("Completed", RunResourceRunCompleted).pipe(
  Telemetry.logWarning(
    "RunResourceStore write failed for run completion",
    ({ runId }) => ({ runId: String(runId) }),
  ),
);
```

New home: implementation / `Telemetry.Service` when authoring facet — not on bare tag skeleton.

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

Return to this section in a later bake session. **Locked:** `Telemetry.Tag`
skeleton only. Everything below is open.

**Branch:** `cursor/telemetry-redesign-bake-faed` · **Plan:** [20](../plans/20-process-store-split-and-telemetry.md) · **Ecosystem:** [22](../plans/22-effect-ecosystem-adapters.md)

### A. Tag skeleton (minor confirms)

- [ ] Subpath/export: `store/QueueResource` re-export vs dedicated telemetry file?
- [ ] Input type param: `Telemetry.operation<Input>` vs elsewhere?
- [ ] `Telemetry.logWarning` on event defs — stays on tag decl or layer-only?
- [ ] Identity module: file name, subpath (`RunResourceIdentity.ts`?)

### B. Operations API (calling)

- [x] Builder: `op(input).provideLeaf` / `provideRoot` / `assuming*` before `Effect` (agreed)
- [x] Three op kinds: scope-required, scope-inheriting, scope-free (agreed)
- [x] Mid-op: patch / nested scope after obligation met — not substitute for builder (agreed)
- [x] Provider names: `provideLeaf`, `provideRoot`, `assumingLeaf`, `assumingRoot` (proposed lock)
- [x] Explicit `assuming*` — no ambient inference v1 (proposed lock)
- [x] Canonical: `pipe(op(input).provideLeaf(…), Effect.flatMap, gen)` (proposed lock)
- [x] `OperationContext`: `{ input, telemetry, scope }` — scope is live view (agreed)
- [x] `provideLeaf` establishes scope; `patch` updates existing scope only (agreed)
- [x] Nested ops: `effect.pipe(Entry.rateLimit, Effect.flatMap)` (proposed lock)
- [ ] `Scope.patch` — Ref implementation + hidden-field type firewall
- [ ] Shortcut `.gen(input, fn)` — v2?

### B2. Implementation API (`Telemetry.Service`)

- [x] Field sources: `Scope.field`, `Operation.input`, `Exit.*`, `Clock`, `Telemetry.state` (proposed)
- [x] No auto routing of operation input (agreed + proposed)
- [x] `logWarning` on Service event config — not tag skeleton (proposed)
- [x] Service = tag + events wiring + operations + state + layer (proposed)
- [x] Exit-only overload syntax (proposed lock)
- [x] Nested op scope inherit when scope child omitted (proposed lock)
- [ ] Exact Service config schema (object vs fluent builder)
- [ ] `Operation.input("name")` typed key enforcement

### C. Layer composition

- [ ] Layer constructor: `RunResourceTelemetry.layer({ … })` vs `Telemetry.layer(Tag, …)`?
- [ ] Requires/provides matrix (hub, scopes, sinks) — finalize step 8 table
- [ ] No-op without layer — stub emit vs fail at type level?
- [ ] Explicit combined layers naming (`*Compose.layerPersist`)

### D. Emit pipeline

- [ ] Materialization — event fields from **scope** (auto); from **operation input** only via implementation bindings (explicit)
- [ ] Do **not** auto-merge operation input into scope or events
- [ ] Prepare → metrics → hub ordering (plan 17 legs)
- [ ] Wire id helper API (no raw strings in kernel)
- [ ] Validation before hub emit
- [ ] OccurredAt vs observedAt stamping
- [ ] Correlation: `runId`, resource id, entry id — from scope only?

### E. Telemetry state

- [ ] Same object as process scope state; hidden fields; process code cannot read telemetry fields
- [ ] Layer config DX for fields (gauge, counter, timestamp, duration between fields)
- [ ] Parent → leaf inheritance rules (explicit extended parent + leaf scope)
- [ ] Reducers — on which wires / ops updated?
- [ ] **Entry cleanup policy** — when entry-scoped maps are dropped
- [ ] Snapshot/introspection for dashboards — public or internal only?

### F. Registry & sinks

- [ ] Global registry vs per-compose registration
- [ ] Registry init timing (module load vs layer)
- [ ] Sink subscription — by wire id, prefix, facet?
- [ ] Archive vs projection vs broadcast failure isolation
- [ ] `Telemetry.logWarning` behavior on archive persist failure

### G. Hub bridge & kernel boundaries

- [ ] RunResource: which counters leave kernel `Ref` → telemetry state?
- [ ] Gating stays `Semaphore` only — confirm
- [ ] Delete list when bake closes (`defineEvent`, `RunResourceHubTelemetry`, …)

### H. Effect platform integration

- [ ] Tracer spans at operation boundaries — wire to `${typeId}/op/path`?
- [ ] Bridge telemetry state → Effect `Metric`?
- [ ] Test layer — capture emits for assertions

### I. Store/RPC (related, separate from telemetry tag)

- [ ] `Procedure` + `Store.Tag` / `Store.Service` — already decided; implement when?
- [ ] Effect RPC under store transport (plan 16)

### J. Suggested bake order (next sessions)

1. ~~Scope builder + op kinds~~ (done)
2. ~~OperationContext + providers + nested pipe~~ (proposed — owner confirm)
3. **Implementation API** — lock Service config schema + typed `Operation.input` / `Scope.field`
4. **`Scope.patch`** — process vs hidden fields
5. Emit pipeline order + registry + RunResource boundary
6. Sign off → plan 21 → tag skeleton port (RunResource)

---

## Open recipe steps (bake in order)

Steps 1–2 are **locked** vs **open** as marked. Steps 3–9 remain from the
original bake sequence, updated for `Telemetry.Tag` where noted.

### Step 1 — `Telemetry.Tag` skeleton (**locked**)

**Decides:** Public tag class — contract only; no state, no handlers, no runners.

**Locked shape:** see **Definition surface** above.

**Still to confirm:** subpath, exports, `Telemetry.logWarning` on event defs.

**Acceptance:** Tag file contains skeleton only; golden tree from
`facet-telemetry-158c` ports without adding runtime concerns.

---

### Step 2 — Operations API (**locked**)

Canonical shape, builder, OperationContext — see **Calling API — scope builder** and **OperationContext (agreed)**.

**Acceptance:** Queue `processEntry` stress case in doc; owner confirmed `provideLeaf` + `patch` + `ctx.scope` live view.

---

### Step 3 — Telemetry layer API (**open**)

**Decides:** Layer config for state, scope extension, emit pipeline, registry,
operation handle generation. See **Open questions (session handoff)** §C–G.

**Acceptance:** Tag file unchanged when layer config changes; layer produces
`processEntry(input)` handles.

---

### Step 4 — `Telemetry.registry`

**Decides:** Wire registration, sink subscription, relationship to hub init.

**Recommended ingredients:**

```ts
Telemetry.registry([RunResourceTelemetry, QueueResourceTelemetry])
// → hub knows wire ids + schemas for sink matching
// ArchiveSink / ProjectionSink derive legs from registry + codec — no hand wires
```

- Registration at module init or explicit registry layer (bake choice).
- Sinks opt in by wire id (recipe step 2 locked).
- Archive registry stays separate (`ProcessStore.registry` → archive facets only).

**Acceptance:** Document minimal v1 API; owner signs off on one global registry vs per-compose registration.

---

### Step 5 — Telemetry state API

**Decides:** Service tag, lifetime, who updates, interaction with emit legs.

**Recommended ingredients:**

```ts
// In-memory only; provided by RunResourceTelemetry.layer (or TelemetryState.layer scoped to domain)
interface RunResourceTelemetryState {
  readonly incrementEmit: (wire: string) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<Readonly<Record<string, number>>>
}

// Updated only inside emit pipeline / metrics leg — kernel cannot yield* TelemetryState
```

- Lifetime: same as worker / gate instance (or telemetry compose scope).
- `prepare` / `metrics` pipe legs (plan 17 phase 2) read/write telemetry state before hub emit.
- Never serialized to `RuntimeStorage`.

**Alternatives:** Ref inside hub (rejected — not siloed per domain); reuse projection (rejected).

**Acceptance:** Owner confirms fields, lifetime, and that process code never imports telemetry state.

---

### Step 6 — Hub emit bridge (internal)

**Decides:** How tree statics reach `TelemetryHub.emit` without spine in emit `R`.

**Recommended flow:**

```text
yield* QueueResourceTelemetry.Entry.Retried
  → materialize from event schema + active scope + telemetry state + op context
  → read/update telemetry state (optional leg)
  → TelemetryHub.emit({ wire, schema, payload })
  → sinks (archive / projection / broadcast / logs)
```

Operation start/exit events are emitted by the operation runner (step 2), not by
manual kernel calls. `Telemetry.start` input is consumed only when the runner opens
the operation.

- Persist sink uses `ArchiveSink` + spine — **not** inline in emit `R`.
- `Telemetry.logWarning` applies to archive persist failures on sink path.

**Acceptance:** Sequence diagram signed off; test plan: emit with hub only; emit + archive sink; no store in emit R.

---

### Step 7 — RunResource kernel boundary

**Decides:** What stays in process vs telemetry for gate counters.

**Recommended:**

- Process: `Semaphore`, `RunScope.run` with `runId`, user effect.
- Telemetry: counters (`waiting`, `inFlight`, …) move to **telemetry state** or emit-side reducer; `State.Changed` still emitted via tree.
- Delete kernel-owned `stateRef` once telemetry state exists.

**Acceptance:** Owner confirms which RunResource counters are telemetry-only vs required for gating (gating uses semaphore only).

---

### Step 8 — Layer matrix (siloed vs combined)

**Decides:** Default exports for apps; naming.


| Layer                                  | Requires           | Provides                       |
| -------------------------------------- | ------------------ | ------------------------------ |
| `TelemetryHub.layer`                   | —                  | emit                           |
| `RunResourceTelemetry.layer`           | hub                | state + operations API + emit bridge |
| `RunResourceStore.layerRuntimeStorage` | `RuntimeStorage`   | queries                        |
| `ArchiveSink.layerForStore(...)`       | storage + hub      | persist leg                    |
| `RunResourceProjection.layerLive`      | hub                | live read                      |
| `RunResourceCompose.layerPersist`      | **explicit merge** | convenience                    |


**Acceptance:** Table approved; no monolithic layer pulls all facets + transports without explicit name.

---

### Step 9 — Migration & delete list

**Decides:** What dies on hub branch when bake closes.

**Delete / replace:**

- `TelemetryHub.defineEvent` usage in facet modules
- `RunResourceHubTelemetry` namespace
- Hand-duplicated wire const arrays in `RunResourceStore` / `RunResourceTelemetry`
- Kernel `Ref` counters (after telemetry state)
- Docs referencing `store/runResource/` folders, transport-only parallel agent as primary path

**Keep:**

- `TelemetryHub`, sink modules, projection pilot, transport merge, flat `store/RunResource*.ts`

**Acceptance:** Owner approves delete list; changeset note for breaking emit surface.

---

## Rejected substitutions (record during bake)


| Proposal                                          | Reason                                 |
| ------------------------------------------------- | -------------------------------------- |
| `defineEvent` as SSoT                             | Bypasses plan 17 DSL; caused hub drift |
| Durable `ProcessStore.state` as “telemetry state” | Wrong vocabulary — ops storage         |
| Domain folders under `store/`                     | Owner: role folders only               |
| Procedure `.success` / `.failure` on telemetry ops  | Store/RPC only — telemetry uses `start` / `exit` |
| Operation bodies / handlers on `Telemetry.Tag`    | Tag is skeleton — Operations API + layer |
| Telemetry state on `Telemetry.Tag`                | Tag is skeleton — state on layer       |
| Telemetry counters in kernel `Ref`                | Violates telemetry-only boundary       |


---

## Bake finish line — close session, start building

### Done (enough to start Slice A)

- `Telemetry.Tag` skeleton DSL
- Three APIs: Tag / Calling / Implementation (`Telemetry.Service`)
- Operations: input on `Telemetry.operation<Input>`, builder `provideLeaf` / `assuming*`
- OperationContext: `{ input, telemetry, scope }` — scope live view; `patch` mid-op
- Three op kinds; exit-only overload; nested inherit scope
- Field sources on Service; no auto operation-input routing
- End-to-end Queue `processEntry` target documented

### Close bake — owner decisions still needed (~1 session)

Pick defaults for v1 so implementation agents do not stall:

| # | Decision | Recommendation for v1 |
| --- | --- | --- |
| 1 | **`Telemetry.Service` config shape** | Tag nested inside Service class; `events` map with `fields` + optional `logWarning` (see doc sketch) |
| 2 | **Registry** | Explicit `Telemetry.registry([...Tags])` at app compose; not module auto-init |
| 3 | **No telemetry layer** | Emits no-op (hub not required in R for stub); full layer required for real emit |
| 4 | **Layer matrix** | Approve step 8 table as-is; `RunResourceTelemetry.layer` requires hub |
| 5 | **Hub bridge order** | materialize → optional metrics leg → `TelemetryHub.emit` → sinks |
| 6 | **RunResource boundary** | Counters (`waiting`, `inFlight`, …) → telemetry state; gating stays `Semaphore` only |
| 7 | **Entry telemetry cleanup** | Drop entry hidden state when op exit completes (success/fail/interrupt) |
| 8 | **Tag file layout** | Single `store/RunResourceTelemetry.ts` Service + re-export tag; identity module sibling |
| 9 | **Delete list** | Approve step 9 as-is |

Defer to implementation (do not block bake sign-off):

- `Scope.patch` Ref internals
- Typed `Operation.input("key")` enforcement (ship best-effort v1)
- `.gen` shortcut, tracer spans, registry auto-discovery
- Full telemetry state reducer DSL polish

### Implementation slices (after bake sign-off)

| Slice | Deliverable |
| --- | --- |
| **A** | `Telemetry.Tag` factory + RunResource skeleton port (`facet-telemetry-158c`) |
| **B** | `Telemetry.Service` v1 + field sources + `OperationContext` + builder handles |
| **C** | Layer + hub bridge + `Scope.patch` + telemetry state extend |
| **D** | Registry + ArchiveSink wiring; delete `defineEvent` on RunResource |
| **E** | Queue migration (separate branch) |

Update [21-state-vocabulary.md](../plans/21-state-vocabulary.md) when bake closes.

---

## After bake — implementation handoff

1. Update plan 21 with locked outcomes.
2. Slice A: `Telemetry.Tag` factory + RunResource skeleton port.
3. Slice B: `Telemetry.Service` + Operations API builder + OperationContext.
4. Slice C: layer + hub bridge + `Scope.patch` + telemetry state extend.
5. Slice D: registry + RunResource hub bridge + delete `defineEvent`.
6. Slice E: Queue on separate branch.

**Verification (every slice):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

**Changeset:** required before merge to integration branch (owner approval).

---

## Bake session checklist

- [x] Step 1 — `Telemetry.Tag` skeleton locked
- [x] Step 2 — Operations API + OperationContext locked
- [ ] Step 2b — `Telemetry.Service` config shape (finish line #1)
- [ ] Step 3 — layer API + no-op policy (finish line #3–5)
- [ ] Step 4 — registry v1 (finish line #2)
- [ ] Step 5 — telemetry state + entry cleanup (finish line #7)
- [ ] Step 6 — hub bridge flow (finish line #5)
- [ ] Step 7 — RunResource kernel boundary (finish line #6)
- [ ] Step 8 — layer matrix (finish line #4)
- [ ] Step 9 — delete list (finish line #9)
- [ ] Plan 21 updated
- [ ] Owner bake sign-off

