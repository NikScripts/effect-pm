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

### Jun 2026 — Service DX correction (owner)

Owner rejected flat `events` / `operations` config on Service. **Service must mirror Tag tree** with optional additions on the same nodes (`Telemetry.start(…, bindings)`, `Telemetry.extend(scope, …)`, `.pipe(Telemetry.logWarning(…))`). Tag skeleton stays binding-free for catalog imports.

### Jun 2026 — Service bindings + logWarning (owner)

- **`Telemetry.extend(scope, { … })`** — locked as shown (metric timestamp, duration, gauge, …).
- **Event bindings (3rd arg)** — required **only for schema fields that are plain `Schema.*`** (not scope-bound, not terminal, not literal). Scope selectors, `Telemetry.terminal.*`, and literals materialize automatically; **Service must supply a source for every remaining schema field** (`Operation.input`, `Exit.*`, `Clock`, `Telemetry.state`, …). Type-level completeness on Service declarations.
- **`Telemetry.logWarning`** — **pipe** on event node (Service only), same as today:

```ts
Telemetry.event("Changed", RunResourceStateChanged).pipe(
  Telemetry.logWarning(
    "RunResourceStore write failed for state change",
    ({ reason }) => ({ reason: String(reason) }),
  ),
),
```

Not on bare Tag skeleton. Callbacks receive the **materialized event row**.

---

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

Lives on **`Telemetry.Service`**: **the same tree DSL as `Telemetry.Tag`**, with optional **additions on the same nodes** — not a parallel config object (`events: { … }`, `operations: { … }`).

| Addition | Where in tree | Tag skeleton | Service |
| --- | --- | --- | --- |
| Wire + schema | `Telemetry.event` / `start` / `exit` | ✓ | ✓ (same) |
| **Field bindings** | optional 3rd arg when schema has plain `Schema.*` fields | — | **required** for every such field; `Operation.input`, `Exit.*`, … |
| **`logWarning`** | `.pipe(Telemetry.logWarning(…))` on event node | — | Service only — archive persist failure |
| **Telemetry state** | `Telemetry.extend(scope, fields)` under namespace | — | hidden scope fields + reducers |
| **Layer + handles** | on Service class | — | `.layer`, generated `Entry.processEntry`, … |

**Schema field kinds** (from `Telemetry.Schema` — plan 17):

| Kind | Example | Service binding |
| --- | --- | --- |
| **Scope-bound** | `QueueEntryState.Entry.entryId` | Auto from active scope |
| **Terminal** | `Telemetry.terminal.clockMillis`, duration helpers | Auto at emit |
| **Literal** | `Schema.Literal("completed")` | Auto |
| **Plain schema** | `Schema.String`, `Schema.Number`, optional wrappers | **Must bind** on Service — e.g. `Operation.input("name")` |

If an event schema has **no** plain-schema fields, omit the 3rd arg entirely
(`Telemetry.event("Retried", QueueEntryRetried)`). Tag and Service trees match.

**No automatic** operation-input routing — each plain-schema field names its source explicitly.

Field source vocabulary:

| Source | Use |
| --- | --- |
| **`Scope.field(path)`** | Rare override; scope-bound schema fields usually need no entry |
| **`Operation.input(key)`** | From operation input |
| **`Exit.value`** / **`Exit.cause`** / **`Exit.durationMs`** | Exit events |
| **`Clock.now`** | When not using terminal |
| **`Telemetry.state(path)`** | Hidden scope fields / reducers |

---

### `Telemetry.Service` — Tag-shaped tree + additions (proposed)

**Rejected:** nested `tag` + flat `events` / `operations` / `state` maps (duplicate structure, bad DX).

**Tag skeleton** (unchanged — importable without layer):

```ts
class QueueResourceTelemetry extends Telemetry.Tag<QueueResourceTelemetry>(id)(
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
    Telemetry.group("Lifecycle")(
      Telemetry.event("Started", QueueLifecycleStarted),
      …
    ),
  ),
) {}
```

**Service** — same tree; bindings only where schema has plain fields; `logWarning` via pipe:

```ts
class QueueResourceTelemetry extends Telemetry.Service<QueueResourceTelemetry>(id)(
  Telemetry.namespace("Queue")(
    Telemetry.extend(QueueEntryScope, {
      enqueuedAt: Telemetry.metric.timestamp,
      startedAt: Telemetry.metric.timestamp,
      waitMs: Telemetry.metric.duration("enqueuedAt", "startedAt"),
    }),
    Telemetry.group("Entry")(
      Telemetry.operation<{ name: string }>("processEntry")(
        QueueEntryScope,
        Telemetry.start("Started", QueueEntryStarted, {
          name: Operation.input("name"),
        }),
        Telemetry.event("Retried", QueueEntryRetried),
        Telemetry.operation("rateLimit")({
          onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
        }),
        Telemetry.exit({
          onSuccess: Telemetry.event("Completed", QueueEntryCompleted),
          onFailure: Telemetry.event("Failed", QueueEntryFailed).pipe(
            Telemetry.logWarning(
              "QueueResourceStore write failed for Entry.Failed",
              ({ entryId }) => ({ entryId: String(entryId) }),
            ),
          ),
          onInterrupt: Telemetry.event("Released", QueueEntryReleased),
        }),
      ),
    ),
    Telemetry.group("Lifecycle")(
      Telemetry.event("Started", QueueLifecycleStarted),
      …
    ),
  ),
) {}
```

**Binding block:** flat record (3rd arg) — one entry per plain-schema field; TypeScript enforces completeness against the event schema. **`logWarning`:** `.pipe(Telemetry.logWarning(…))` on the event node — not inside the binding record.

Service class also exposes **`.layer`** and generated operation handles. Tag class does not.

---

### `Telemetry.Service` vs `Telemetry.Tag` (proposed)

| Export | Contents |
| --- | --- |
| **`Telemetry.Tag` class** | Skeleton tree only — registry / transport catalog; no bindings, no layer |
| **`Telemetry.Service` class** | Same tree + optional bindings + `Telemetry.extend` + `.layer` + handles |
| **Facet authoring** | Use **Service** in `store/*Telemetry.ts` |
| **Wire catalog** | Tag extracted from Service tree (or hand-maintained Tag for split files) |

Single file per facet is fine: `store/QueueResourceTelemetry.ts` exports Service; Tag skeleton is the tree without binding args (generated or duplicated — bake TBD).

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

**Service binds** `Started.name ← Operation.input("name")` on the **same** `Telemetry.start(…)` node; scope fields omitted when schema + scope cover them.

---

### `Telemetry.Service` (implementation API sketch)

Tag alone is not enough — skeleton is used to build the facet **and** the wiring API.

- **`Telemetry.Tag`** — importable contract; no handlers, no state config, no input routing.
- **`Telemetry.Service`** (name TBD) — define tag skeleton + implementation together: input routing, scope extension, logWarning, layer, generated operation handles.

Old DX (keep **`logWarning` pipe** on Service event nodes):

```ts
Telemetry.event("Changed", RunResourceStateChanged).pipe(
  Telemetry.logWarning(
    "RunResourceStore write failed for state change",
    ({ reason }) => ({ reason: String(reason) }),
  ),
),
```

New home: **`Telemetry.Service`** tree — same pipe; not on bare Tag skeleton.

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

- **Tag:** skeleton only — no bindings, no layer, no logWarning
- **Service:** Tag tree + `extend` + bindings (plain schema fields) + `.pipe(logWarning)`
- **Calling:** builder → `{ input, telemetry, scope }` live view
- **Layer:** `DomainTelemetry.layer`; no-op stub without layer
- **Registry:** `Telemetry.registry([...])` at compose
- **Emit:** materialize → metrics → hub → sinks; runner owns start/exit
- **RunResource:** counters → telemetry state; delete `stateRef`
- **Deferred:** `Scope.patch` internals, `.gen`, tracers, strict `Operation.input` keys

### I. Store/RPC (separate track — not telemetry bake)

- [ ] `Procedure` + `Store.Tag` / `Store.Service` — decided; implement when?
- [ ] Effect RPC under store transport (plan 16)

---

## Open recipe steps (bake in order)

Steps 1–2 are **locked** vs **open** as marked. Steps 3–9 remain from the
original bake sequence, updated for `Telemetry.Tag` where noted.

### Step 1 — `Telemetry.Tag` skeleton (**locked**)

**Decides:** Public tag class — contract only; no state, no handlers, no runners.

**Locked shape:** see **Definition surface** above.

**Still to confirm:** subpath, exports.

**Acceptance:** Tag file contains skeleton only; golden tree from
`facet-telemetry-158c` ports without adding runtime concerns.

---

### Step 2 — Operations API (**locked**)

Canonical shape, builder, OperationContext — see **Calling API — scope builder** and **OperationContext (agreed)**.

**Acceptance:** Queue `processEntry` stress case in doc; owner confirmed `provideLeaf` + `patch` + `ctx.scope` live view.

---

### Step 3 — Telemetry layer API (**locked**)

| Decision | v1 lock |
| --- | --- |
| Layer home | **`RunResourceTelemetry.layer`** static on Service class — wiring from Service tree |
| Layer args | **No config object v1** — tree is SSoT; reject `Telemetry.layer(Tag, config)` for facets |
| **No layer** | Handles + middle-event yields = **no-op**; kernel **`R` excludes `TelemetryHub`** |
| **With layer** | **Requires** `TelemetryHub`; **provides** emit bridge + telemetry state + operation handles |
| Combined compose | Explicit only — e.g. `RunResourceCompose.layerPersist`; no implicit all-facets layer |

---

### Step 4 — `Telemetry.registry` (**locked**)

```ts
Layer.provideMerge(
  Telemetry.registry([RunResourceTelemetry, QueueResourceTelemetry]),
)
```

| Decision | v1 lock |
| --- | --- |
| Registration | **Explicit compose** — `Telemetry.registry([...Services])` returns a **Layer** |
| Timing | Layer build — **not** module import side effects |
| Scope | Telemetry Services only — **`ProcessStore.registry`** = archive facets |
| Sink matching | By **wire id** from registry catalog |
| Global singleton | **Rejected** — per-compose registry layer |

---

### Step 5 — Telemetry state API (**locked**)

| Decision | v1 lock |
| --- | --- |
| Storage | **Same object** as process scope; process types exclude hidden fields |
| Declaration | **`Telemetry.extend(scope, fields)`** on Service tree |
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
  2. materialize: schema + Service bindings + Exit.* / op input
  3. optional metrics leg → telemetry state
  4. validate payload
  5. TelemetryHub.emit
  6. sinks fan-out (failures isolated per sink)
```

| Decision | v1 lock |
| --- | --- |
| Start / exit | **Operation runner** emits |
| Middle events | **`yield* ctx.telemetry.*`** on handle |
| Wire ids | **`Telemetry.Wire<typeof Service>`** — no raw strings in kernel |
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
| `RunResourceTelemetry.layer`           | hub                | state + operations API + emit bridge |
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
| Telemetry facet file | `store/<Domain>Telemetry.ts` — **Service** tree + `.layer` |
| Tag catalog | Extract skeleton from Service for registry / transport — optional split file only if huge |
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
| Operation bodies / handlers on `Telemetry.Tag`    | Tag is skeleton — Operations API + layer |
| Telemetry state on `Telemetry.Tag`                | Tag is skeleton — state on layer       |
| `Telemetry.layer(Tag, config)` for facets | Service tree is SSoT — `.layer` on Service class, no separate config object |
| Global telemetry registry singleton | Per-compose `Telemetry.registry([...])` Layer |
| Module import registry side effects | Explicit Layer at compose |


---

## Bake finish line — **closed** (Jun 2026)

All steps 1–9 locked. Implementation agents may start slices; owner review welcome but not blocking.

### Locked summary

| Area | Lock |
| --- | --- |
| Tag | Skeleton DSL — namespace / group / operation / event / start / exit |
| Calling | Builder + `{ input, telemetry, scope }` + `provideLeaf` / `assuming*` |
| Service | Tag tree + `extend` + binding 3rd arg (plain schema only) + `.pipe(logWarning)` |
| Layer | `DomainTelemetry.layer` on Service; no-op without layer; hub required for real emit |
| Registry | `Telemetry.registry([...])` as explicit compose Layer |
| State | Hidden fields on same scope object; entry cleanup on op exit |
| Emit | materialize → metrics → validate → hub → sinks |
| RunResource | Counters off kernel `Ref`; gating = semaphore |
| Layout | `store/*Telemetry.ts`, `src/*Identity.ts` |
| Delete | `defineEvent`, `RunResourceHubTelemetry`, kernel `stateRef`, duplicate wire consts |

### Implementation slices (for other agents)

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
- [x] Step 2b — Service = Tag tree + extend + bindings + logWarning pipe
- [x] Step 3 — layer API + no-op policy
- [x] Step 4 — registry v1
- [x] Step 5 — telemetry state + entry cleanup
- [x] Step 6 — hub bridge flow
- [x] Step 7 — RunResource kernel boundary
- [x] Step 8 — layer matrix
- [x] Step 9 — delete list
- [x] Plan 21 updated
- [x] Bake closed — ready for implementation slices

