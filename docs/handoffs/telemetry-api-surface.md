# Telemetry / State — API surface inventory

**Status:** Active bake (Jun 2026). Companion to [telemetry-redesign-decisions.md](./telemetry-redesign-decisions.md) (semantics = source of truth). **This doc names every part of the API surface.** Plan: (1) name everything [this doc], (2) walk it **one item at a time** documenting *every form* — signature variants, where accepted, how to use, (3) **Bundle** shape last.

**Naming:** `Telemetry.Tag` has two shapes — **Compose** (over a standalone `State.Tag`; telemetry-optional) and **Bundle** (single `Telemetry.Tag`, no standalone `State.Tag`). No "Form 1 / Form 2".

**Ids:** `State.Tag` and `Telemetry.Tag` each carry their own required, distinct id — `<Resource>/<Name>` (`…/QueueState`, `…/QueueTelemetry`). Scopes too (`…/QueueScope`, `…/EntryScope`).

**Legend:** 🔶 forms TBD (walk) · ✅ locked · 🕓 deferred · ⛔ dropped / not-a-thing. Item IDs are stable — reference them when locking forms.

---

## 1. Module functions — `State`
- **S1** · `State.Scope(domain)(id, fields)` — declare a **top-level scope** (first **branch** off `State.Root`); `fields` required (no empty scopes) · ✅
- **S2** · `State.Tag<Self>(domain)(stateId, …parts)` — **structure-only** tag (ops/scopes/handles/spans; no schemas; one namespace; no-op without a telemetry layer) · ✅
- **S3** · `State.operation(name, scope?, Input?)(…triad)` — **operation** anchor (start / `inner` / exit); define + call covered together (§10 Operations) · ✅
- **S4** · `State.inner(…)` — the `ctx` surface (middle events, nested ops, group-import) · 🔶
- **S5** · `State.branch(name, fields)` — inline single-use branch (op scope arg); no id, no telemetry half; `fields` required · ✅
- **S6** · `State.Root` — the **real root** of the scope tree (run-level state; `runId` → `e.state.runId`); every `State.Scope` is a branch off it · 🔶
- **S7** · `State.Changed` — internal transition event; `State.Changed.operation` format (§6.6) · 🔶

## 2. Module functions — `Telemetry`
- **T1** · `Telemetry.Tag<Self>(StateTag, GlobalBase?)(telId, tree)` — **Compose** (richer tag over a `State.Tag`) · 🔶
- **T2** · `Telemetry.Tag<Self>(domain, GlobalBase?)(telId, structure)` — **Bundle** (single self-contained tag) · 🔶 (last)
- **T3** · `Telemetry.Service(Tag, wiring)` — runtime = tag + wiring + layer · 🔶
- **T4** · `Telemetry.Schema<Self>(ScopeTel?)((e) => …)` — reusable schema base (scope-bound, or scope-free global) · 🔶
- **T5** · `Telemetry.namespace(name)(…parts)` — ref-shortener (enclosing namespace) · 🔶
- **T6** · `Telemetry.group(name, Default?)(…parts)` — group label + optional default base · 🔶
- **T7** · `Telemetry.event(name, schema?)` — name an **inner** (middle) event · 🔶
- **T8** · `Telemetry.declare(name, schema?)` — named cross-site event (name-only / schema-carrying) · 🔶
- **T9** · `Telemetry.start(name, schema?)` — **start** leg · 🔶
- **T10** · `Telemetry.exit(…outcomes)` — **exit** leg (success / interrupted / failure fold) · 🔶
- **T11** · `Telemetry.success(name, schema?)` — exit outcome · 🔶
- **T12** · `Telemetry.interrupted(name, schema?)` — exit outcome · 🔶
- **T13** · `Telemetry.failure(name, schema?)` — exit outcome · 🔶
- **T14** · `Telemetry.spread(group)` — flat group-import into `inner` (drops prefix) · 🔶
- **T15** · `Telemetry.update(…)` — wiring-side telemetry-state write · 🔶 (shape OPEN)

## 3. Metric markers — `Telemetry.metric.*`
- **M1** · `Telemetry.metric.gauge` — gauge field marker (telemetry-state) · 🔶
- **M2** · `Telemetry.metric.counter` — counter marker · 🔶 (confirm exists)
- **M3** · `Telemetry.metric.histogram` — histogram marker · 🔶 (confirm exists)
- **M4** · `Telemetry.metric.summary` — summary marker · 🔶 (confirm exists)

## 4. Service classes — methods on produced classes

### 4a. Scope class — `State.Scope(...)` / `.Branch(...)` result
- **C1** · `.Branch(name, fields)(id)` — deeper branch off a **base** scope (new identity + id); `fields` required · ✅
- **C2** · `.Telemetry(fields)` — telemetry half of any base scope (root or branch); **once per scope**; no new id · ✅
- **C3** · scope entry (root) — primary `.provide(values)` (pipeable, symmetric with op.provide); `.layer(values)` composable escape hatch; decoded values · ✅

### 4b. Telemetry scope class — `.Telemetry(...)` result (`…Tel`)
- **C4** · `.event((e) => …)` — inline scope-bound schema value (no base) · 🔶
- **C5** · ~~`.Branch` from the Tel half~~ — ⛔ dropped (you branch **base** scopes only; Tel halves are added per-level via `.Telemetry`)

### 4c. Schema base class — `Telemetry.Schema(...)` result
- **C6** · `.extend((e) => …)` — base + extras (field-adding; **never a bare arrow**) · 🔶
- **C7** · `.Schema(ScopeTel)((e) => …)` — extend into another reusable base · 🔶

### 4d. `State.Tag` instance
- **C8** · operation handles (`.enqueue`, `.processEntry`, …) — every call returns `Effect<ctx>` (§10 Operations) · ✅
- **C9** · `.provide(scopeValues)` — supply the scope **dependency** (optional; inherited = already in context) · ✅

### 4e. `Telemetry.Tag` instance
- **C10** · event handles (`.Lifecycle.Started`, …) — emit standalone events (grouped) · 🔶
- **C11** · operation handles — invoke ops (typed payloads) · 🔶
- **C12** · `.provide(scopeValues)` — bind scope to a call · 🔶
- **C13** · `ctx.*` — nested ops (camelCase) + middle/imported events (PascalCase) on the `ctx` root (§10 ctx) · ✅

### 4f. `Telemetry.Service`
- **C14** · `.layer` — the runtime layer (wiring bound) · 🔶

## 5. Schema context `e` (inside `Telemetry.Schema` / `.extend` / `.event`)
- **E1** · `e.root` — the **outermost `State.Scope`** (root of your declared scope tree; navigable: fields + telemetry + nested branches; intersection-gated). `State.Root` (run root) is reached via `e.state`, not `e.root`. · ✅
- **E2** · `e.leaf` — current deepest branch (scope trio with `e.root` / `e.state`) · ✅
- **E3** · `e.input` — operation input (from `State.operation` `Input`) · 🔶
- **E4** · `e.exit` — exit-only: `e.exit.duration`, `e.exit.cause`, … · 🔶
- **E5** · `e.clock` — timestamp source · 🔶
- **E6** · `e.state` — the **state root** (`State.Root`): run-level/persistent state incl. `runId` (`e.state.runId`); needs no scope · ✅

## 6. Call / runtime surface (process side)
- **R1** · `op(input).provide({ …scope })` — invoke an operation with input + scope · 🔶
- **R2** · `Scope.layer({ …fields })` — open a scope at the runtime boundary · 🔶
- **R3** · `ctx.scope` — process view of the open scope: `.leaf` / `.root` / `.state` (telemetry half hidden) · ✅
- **R4** · `ctx.input` — the operation's input inside the body · ✅
- **R5** · `ctx` — the op body surface: nested ops (camelCase) + middle/imported events (PascalCase) on root · ✅
- **R6** · `Effect.provide(Service.layer)` — install the telemetry runtime · 🔶

## 7. Reserved / special
- **X1** · wire = `Namespace.Group.Event` — every event's three-string identity
- **X2** · `Internal` namespace — reserved (e.g. `Internal.State.Changed`)

## 8. Deferred / dropped
- **D1** · `Telemetry.import(…)` — 🕓 deferred (cross-facet catalogs)
- **D2** · `Telemetry.wires({…})` — 🕓 deferred (predefined shared catalogs)
- **D3** · multiple namespaces per Tag — 🕓 deferred
- **D4** · `Telemetry.Event(Tag, "id")` — ⛔ dropped (use the tree)
- **D5** · `Telemetry.default(…)` as a leg part — ⛔ not-a-thing (default = `group(name, Default)` / `default:` key)

---

## 9. Walk order (grouped — finish a group before the next)
1. **Scope** (State.Scope subsystem): S1 ✅ → C1 `.Branch` → C2 `.Telemetry` → C3 `.layer` → S5 `State.branch` (inline). [C5 dropped; C4 `.event` covered with schemas.]
2. **State.Tag**: S2 → C8 (op handles) → C9 (`.provide`).
3. **Operations**: S3 `State.operation` → S4 `State.inner` (+ T14 `spread` / group-import).
4. **Taxonomy**: T5 `namespace` → T6 `group`.
5. **Legs**: T9 `start` → T10 `exit` → T11/T12/T13 outcomes.
6. **Events**: T7 `event` → T8 `declare`.
7. **Schemas**: T4 `Schema` → C6 `.extend` → C7 `.Schema` → C4 `ScopeTel.event` → M1–M4 metric → E1–E6 context `e`.
8. **Compose tag**: T1 → C10–C13 (handles, `ctx`, `.provide`) → R1–R6 runtime.
9. **Wiring**: S6 `Root` → S7 `Changed` → T15 `update`.
10. **Bundle (last)**: T2.
11. **Service**: T3 → C14.

---

## 10. Locked forms
*(filled as we walk — each item's every shape as a type + usage example.)*

### S1 · `State.Scope` ✅
The first branch off `State.Root` (not the root — S6 is). Single call shape; `fields` required (no empty scopes).
```ts
declare const Scope: <Domain extends State.Domain>(domain: Domain) =>
  <const Id extends string, Fields extends Schema.Struct.Fields>(
    id: Id,           // required, "<Resource>/<Name>"
    fields: Fields,   // required, plain Schema only (metric markers belong to .Telemetry / C2)
  ) => State.ScopeClass<Domain, Id, Fields>
```
```ts
// declare a top-level scope
class QueueScope extends State.Scope(QueueResource)("@scope/queue/QueueScope", { queueId: Schema.String }) {}
// produced class exposes: .Branch (C1), .Telemetry (C2), .layer (C3)
```
Resolved: `leaf`→`branch` for node-creating APIs (`.Branch`/`State.branch`; `e.leaf` kept). `e.root` = outermost `State.Scope`; `State.Root` (run root) via `e.state`.

### C1 · `.Branch` ✅
On a **base** scope — adds a deeper branch (child scope, new identity + id). Curried `(name, fields)(id)`; `fields` required (no empty scopes). Branch the **base** tree only; the Tel half is added per-level with `.Telemetry` (C2). (C5 — branching the Tel half — dropped.)
```ts
interface ScopeClass</* … */> {
  Branch: <const Name extends string, Fields extends Schema.Struct.Fields>(
    name: Name,        // branch/scope segment, unique per namespace
    fields: Fields,    // required, plain Schema only (metric markers → .Telemetry / C2)
  ) => <const Id extends string>(id: Id) => State.ScopeClass</* child */>
}
```
```ts
class EntryScope extends QueueScope.Branch("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}
class AttemptScope extends EntryScope.Branch("Attempt", { attempt: Schema.Number })("@scope/queue/AttemptScope") {}
```

### C2 · `.Telemetry` ✅
The telemetry-state half of a base State scope. Works on **any** base scope (root or any branch), **once per scope** (multi-call deferred). No new id — derives the base's identity. `fields` accepts plain `Schema` and/or metric markers (`Telemetry.metric.*`); read by schemas via `e.root`/`e.leaf`; hidden from `ctx.scope`.
```ts
interface StateScope</* … */> {
  Telemetry: <Fields extends Telemetry.StateFields>(
    fields: Fields,
  ) => Telemetry.ScopeTelClass</* same identity + Fields */>
}
```
```ts
class QueueScopeTel extends QueueScope.Telemetry({
  inFlight: Telemetry.metric.gauge,
  lastPriority: Schema.Number,
}) {}

class EntryScopeTel extends EntryScope.Telemetry({
  attemptsSoFar: Schema.Number,
}) {}
```

### C3 · root scope entry ✅
Opening the root scope is **symmetric with opening a branch in an op** — same `.provide` verb. `.layer` stays as a composable escape hatch. Both take the scope's own **decoded** field values; root scope only (deeper branches open per-call via `op.provide`, R1 / C9).
```ts
interface StateScope</* …, */ Fields> {
  // primary — pipeable, same shape as op.provide
  provide: (
    values: Schema.Struct.Type<Fields>,
  ) => <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, Exclude<R, this>>

  // escape hatch — composable Layer
  layer: (
    values: Schema.Struct.Type<Fields>,
  ) => Layer<this>
}
```
```ts
// primary — symmetric with ops
program.pipe(
  QueueScope.provide({ queueId }),
)

// op opens a branch — identical shape
op(input).pipe(
  QueueTelemetry.processEntry.provide({ entryId }),
)

// escape hatch
queueRuntime.pipe(
  Effect.provide(QueueScope.layer({ queueId })),
)
```

### S5 · `State.branch` ✅
Inline single-use branch, passed as an op's scope argument — the throwaway counterpart to `.Branch` (C1). Lowercase (inline value, not a class). **No id** (anonymous/single-use), **no telemetry half**, `fields` required.
```ts
declare const branch: <
  const Name extends string,
  Fields extends Schema.Struct.Fields,
>(
  name: Name,
  fields: Fields,
) => State.InlineBranch<Name, Fields>
```
```ts
State.operation("checkpoint", State.branch("Checkpoint", { at: Schema.Number }))(
  ["Saved"],
)
```

### S2 · `State.Tag` ✅
The **structure-only** tag: operations, scopes, handles, and spans for a domain — **no schemas, no telemetry state**. It's the cheap, client-safe half of the pair; with no `Telemetry.Service` layer installed it is a **no-op** (calls still run, nothing is emitted). The `Telemetry.Tag` (Compose, T1) layers schemas + state on top of it.

**Signature**
```ts
declare const Tag: <Self>(
  domain: Domain,                           // the resource the tag is bound to (QueueResource)
) => (
  stateId: string,                          // required id, convention "<Resource>/…State"
  ...parts: ReadonlyArray<StatePart>,       // the structure (a Telemetry.namespace wrapper)
) => StateTagClass<Self>                     // class to extend; instance carries the handles
```

**Call shape** — `State.Tag<Self>(domain)(stateId, …parts)`:
- `Self` (type param) + `domain` (value) in the **first** call; `stateId` then the structure in the **second**. `Self` is the subclass being declared (self-referential, as with Effect service tags).
- **`domain`** — the resource (`QueueResource`); ties the tag (and its scopes) to that resource's context.
- **`stateId`** — **required**, `<Resource>/…State` (e.g. `"@scope/queue/QueueState"`). Distinct from the `Telemetry.Tag`'s id (`…/QueueTelemetry`); the two ids must differ.
- **`…parts`** — the structure: a single **`Telemetry.namespace(name)(…)`** wrapper containing groups and operations. **One namespace per Tag** for now (multiple namespaces deferred — D3). Parts are pure structure; nothing here carries a schema (start/exit/inner events are *names only* — their schemas live in the `Telemetry.Tag`, keyed by wire).

**Produces** a class you `extend`. Its instance exposes:
- **operation handles** (C8) — one per `State.operation` (`.enqueue`, `.processEntry`, …), used to invoke the wrapped work.
- **`.provide(scopeValues)`** (C9) — bind a scope to a call.
- standalone-event handles are grouped (`.Lifecycle.Started`); every wire is `Namespace.Group.Event`.

**Semantics**
- **No schemas / no state shape** — that's the `Telemetry.Tag`'s job. Keeping them apart is what makes telemetry *optional* (ship the structure, add observability later).
- **Scopes vs groups are orthogonal** — scopes are a deep tree (S1/C1), groups are a flat wire label; group is never derived from scope.

**Usage**
```ts
class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueState",
  Telemetry.namespace("Queue")(
    Telemetry.group("Lifecycle")("Started", "Paused"),
    Telemetry.group("Entry")(
      State.operation("enqueue", EntryScope)(["Enqueued", "Rejected"]),
      State.operation("processEntry", EntryScope, ProcessInput)(
        "Started",
        State.inner(
          "Retried",
          State.operation("rateLimit")(
            Telemetry.exit(Telemetry.failure(Telemetry.declare("RateLimit", "Exceeded"))),
          ),
        ),
        ["Completed", "Released", "Failed"],
      ),
    ),
  ),
) {}
```
(The structure internals — `State.operation` S3, `State.inner` S4, `Telemetry.namespace`/`group` T5/T6, legs T9–T13 — are documented as their own items.)

### Operations · `State.operation` (S3) + handles (C8) + `.provide` (C9) ✅
An operation **wraps work** (span + lifecycle) and is anchored by `State.operation`. Defining and calling are documented together because they're inseparable.

#### Defining — `State.operation(name, scope?, Input?)(…triad)`
```ts
// 1 — explicit scope, no input
State.operation("enqueue", EntryScope)(
  Telemetry.exit(Telemetry.success("Enqueued"), Telemetry.failure("Rejected")),
)

// 2 — explicit scope, input as a Schema (pullable into event schemas via e.input)
State.operation("processEntry", EntryScope, ProcessInput)(
  Telemetry.start("Started"),
  // …State.inner, Telemetry.exit
)

// 3 — explicit scope, input as a TS type (ctx.input only; not a Schema)
State.operation<{ batchSize: number }>("drainAll", EntryScope)(
  Telemetry.start("Drained"),
)

// 4 — no scope arg: the scope dependency is inherited from context
State.operation("rateLimit")(
  Telemetry.exit(Telemetry.failure(Telemetry.declare("RateLimit", "Exceeded"))),
)

// 5 — inline single-use scope (S5)
State.operation("checkpoint", State.branch("Checkpoint", { at: Schema.Number }))(
  ["Saved"],
)
```
- **Scope = an Effect `R` dependency.** `State.operation(name, Leaf)` requires `Leaf`'s parent in context and provides `Leaf`. Top-level op → kernel provides root; nested op opening a descendant → satisfied by the enclosing op; `State.operation(name)` → inherits ambient. Unsatisfied parent = type error.
- **Input** — Schema (in event schemas via `e.input` **and** `ctx.input`) · TS type (`ctx.input` only) · none.

#### Calling — every call returns `Effect<ctx>`
Whatever the op, a call yields the op's **`ctx`**. So on **any** call you can `yield* it`, `flatMap` it, or pipe work through the handle to wrap it. Four independent axes:

1. **Source** — `QueueOps.op` (top-level, from the Tag) · `ctx.op` (nested, inside a body).
2. **Input** — `op` · `op(input)`.
3. **Scope (dependency)** — `.provide({…})` to supply it, **or omit** if already in context. *Inherited is not a different syntax — `.provide` is simply optional; an explicit-scope op can be called without it, and an inheriting op can still be given it.*
4. **Consume** — `yield* call` · `call.pipe(Effect.flatMap((ctx) => …))` · wrap work: `work.pipe(handle)` / `handle(work)` (data-last / data-first dual).

```ts
// ── get ctx (works on ANY call: input or not, provided or not) ──
const ctx = yield* QueueOps.processEntry({ priority, attempts }).provide({ entryId })
const ctx = yield* QueueOps.processEntry({ priority, attempts })   // scope already in context
const ctx = yield* QueueOps.enqueue.provide({ entryId })           // no-input op also yields ctx
const ctx = yield* ctx.rateLimit                                   // nested op, inherited

QueueOps.processEntry({ priority, attempts })
  .provide({ entryId })
  .pipe(Effect.flatMap((ctx) => /* body */))

// ── wrap existing work (convenience; provide optional; piped or direct) ──
work.pipe(QueueOps.enqueue.provide({ entryId }))   // provide · piped
QueueOps.enqueue.provide({ entryId })(work)         // provide · direct
work.pipe(QueueOps.enqueue)                          // inherited · piped
QueueOps.enqueue(work)                               // inherited · direct
work.pipe(ctx.rateLimit)                             // nested · inherited · piped
ctx.rateLimit.provide({ … })(work)                  // nested · provide · direct
```
- **`.provide` supplies the scope like any dependency** — it can come from `.provide`, an enclosing op, or the root layer; same mechanism.
- **Nested ops** are reached through `ctx` (§ ctx).
- The `Telemetry.Tag` exposes the **same** handles with typed payloads + emission (C11).

### `ctx` — the operation context ✅ (R3/R4/R5/C13)
`ctx` is what an op call yields. It's the in-body surface **for that operation**: what it declared in `State.inner` (S4), plus its input and scope. Each op has its own `ctx`; only *this* op's surface is on it (deeper nested ops appear on *their* `ctx`).

**On the `ctx` root:**
- **nested ops** — **camelCase** (`ctx.rateLimit`, `ctx.attempt`). Called like any op (yield their own ctx; scope inherited or provided).
- **middle events** — **PascalCase** (`ctx.Retried`). `yield* ctx.Retried` or `work.pipe(ctx.Retried)`.
- **imported events** — `Telemetry.spread("Audit")` → flat (`ctx.Granted`); `Telemetry.group("Audit")` → nested (`ctx.Audit.Granted`).

**Reserved members:**
- **`ctx.input`** — decoded op input (only if the op declared one).
- **`ctx.scope`** — process view of the open scope, **path-local** (telemetry half hidden):
  - `ctx.scope.leaf` — current deepest branch
  - `ctx.scope.root` — outermost `State.Scope` (scope root)
  - `ctx.scope.state` — `State.Root` (state root, run-level)

**Rules:**
- **camelCase ops / PascalCase events are enforced at the constructor type level** → disjoint key-spaces, so an op and an event can never collide on `ctx`. `Camel<S> = S extends Uncapitalize<S> ? S : never`; `Pascal<S> = S extends Capitalize<S> ? S : never` (wrong case → readable error type).
- **same-kind duplicates** (event-event / op-op landing on the same key, e.g. a `spread` import shadowing a middle event) = **compile error**; disambiguate via `Telemetry.group` nested-import or rename.
- **`input` / `scope` are reserved** — not valid op names.
- the op's **own start/exit are NOT on `ctx`** (start fires on open; exit synthesized from the `Exit`); only the middle surface is.

```ts
const ctx = yield* QueueOps.processEntry({ priority, attempts }).provide({ entryId })

ctx.input.priority           // op input
ctx.scope.leaf.entryId       // current branch
ctx.scope.root.queueId       // scope root
ctx.scope.state.runId        // state root (State.Root)

const exit = yield* Effect.exit(runHandler(item).pipe(ctx.rateLimit))  // nested op
if (shouldRetry(exit)) yield* ctx.Retried                              // middle event
yield* ctx.Audit.Denied                                                // nested-imported event
```
