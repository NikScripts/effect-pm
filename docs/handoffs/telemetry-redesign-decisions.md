# Telemetry redesign — working decisions

**Status:** Active redesign (Jun 2026). **Capture doc** — what's agreed in the API bake. The authoring surface (State.Tag → Telemetry.Tag, scopes, schemas) is essentially complete; wiring + runtime remain. Loose ends flagged **OPEN** / **NEEDS ATTENTION**.

**Supersedes the framing of:** [telemetry-tag-state-wiring-api-handoff.md](./telemetry-tag-state-wiring-api-handoff.md).

**Grounding:** `effect@4.0.0-beta.76` (verified against installed source — vendored `repos/effect` is stale v3).

**Legend:** ✅ DECIDED · 🔶 OPEN · ⚠️ NEEDS ATTENTION

---

## 0. Module split & layering ✅

The structural layer lives in **`State`**; the observability layer in **`Telemetry`**. Three layers, named so the module tells you which one you're at:

```
State.Tag(domain)(stateId, …)                 → bare structure: ops, scopes, handles, spans. No schemas. No-op without a layer.    (id e.g. ".../QueueState")
  Telemetry.Tag(StateTag, GlobalBase?)(telId, schemaTree)     → richer tag: + schema tree + state (compose — §3, locked)            (id e.g. ".../QueueTelemetry")
  Telemetry.Tag(domain, GlobalBase?)(telId, structure)        → richer tag, one definition        (bundle — §4, locked: inline schemas)
Telemetry.Service(Tag, wiring)                → runtime: + wiring + layer
```

| Layer | Names |
|---|---|
| **State** (operations, scopes) | `State.Tag`; `State.operation`; `State.inner`; `State.leaf`; `State.Scope` → `.withLeaf` → `.telemetry({…})` |
| **Telemetry** (events, taxonomy, schemas) | `Telemetry.namespace` / `Telemetry.group`; `Telemetry.event` / `Telemetry.declare`; `Telemetry.start` / `Telemetry.exit`; `Telemetry.success` / `interrupted` / `failure`; `Telemetry.spread`; `Telemetry.Tag` (richer, two ways); `Telemetry.Schema` (reusable base); `Telemetry.metric.*`; `Telemetry.Service`; schema context `e.root` / `e.leaf` / `e.input` / `e.exit` / `e.clock` / `e.runId` |

- **State** owns `operation`, `inner` (the `ctx.telemetry` container — holds nested ops + middle events), scopes. **Telemetry** owns events, taxonomy, legs (`start`/`exit`), schemas.
- **`start`/`exit` use the bare `State.Tag` API** (`"Started"` / `["Completed","Failed"]` / `Telemetry.start` / `Telemetry.exit`); **`Telemetry.event` names an inner event.** **In `State.Tag` (compose) nothing carries a schema** — start, exit, and inner events are *names only*; their schemas live in the `Telemetry.Tag` tree (§3), keyed by wire. (**Bundle exception:** `Telemetry.declare` may carry a schema to define a multi-placement event once — §1/§4.)
- **`State.Tag` has no schemas** (optional telemetry: provide no layer → no-op; client-cheap).
- **`Telemetry.Tag` has schemas + state shape** — the client/RPC contract.
- **`Telemetry.Service`** = Tag + wiring + layer; "Service" implies the layer, so it's *not* used for the schema-only tag.

Pipeline: wire strings → `State.Tag` adds per-placement scope → `Telemetry.Tag` schemas type field access → runtime backed by Effect primitives (spans, `Metric`, `SubscriptionRef`, `PubSub`, `Context`, `unstable/rpc`).

---

## 1. Wire tree ✅

A wire is **three strings** — `Namespace.Group.Event`. **Inferred** from declarations (default) or imported. Entry points:

- **bare string** — event in the **enclosing `Telemetry.group`**.
- **`Telemetry.declare(…)`** — names an event so a bare **identifier** can reference the **same** event from multiple sites (explicit, order-independent):
  ```ts
  Telemetry.declare("RateLimit", "Exceeded")                            // name one cross-group event
  Telemetry.declare("ExitGroup", ["Success", "Interrupted", "Failed"])  // name several in a group
  Telemetry.declare("Entry.Retried")                                    // single, dotted path
  ```
  **No dotted refs as values** (inferred → nothing to dot into); cross-namespace via `"Namespace.Group.Event"` / `("Namespace", "Group", …)`.
  - **Compose (Example 1, §3):** declare is **name-only** — every schema lives in the separate `Telemetry.Tag` tree, deduped by wire.
  - **Bundle (Example 2, §4):** declare may **carry the schema** (extend form). An event used in **multiple places** is declared **once with its schema**; every other placement references it by **identifier only** — the schema is never repeated:
    ```ts
    Telemetry.declare("Entry.Retried", EntryEvent.extend((e) => ({ attempts: e.leaf.attemptsSoFar })))  // define once
    // other placements: bare "Retried"
    ```
- 🔶 **deferred:** `Telemetry.import(…)` + predefined `Telemetry.wires({…})` (cross-facet shared catalogs) — build when a real shared catalog appears.

Properties: wires come only from the three keys (flat at any depth); identical `(NS, Group, Event)` = one wire (deduped, the same event can appear in many places); **`Internal` namespace is reserved** (e.g. `Internal.State.Changed`). Constraints: leaf-scope names unique per namespace; event names unique per group.

### 1.1 Scope intersection ✅
The wire tree has no scope; `State.Tag` adds it by where each event sits. An event placed in **multiple** locations may read only the **intersection** of those sites' contexts (single-use → full; widely-reused → narrows toward root). **Path-local** — along root→leaf only, never across siblings (§6.2). Schemas type field access against this intersection.

---

## 2. `State.Tag` — structure ✅

**Scopes and groups are orthogonal** — scopes are a deep tree, groups a flat wire label; group is never derived from scope.

### 2.1 Scopes
Referenceable classes; `.telemetry({…})` adds the hidden telemetry half (same identity, no new id):
```ts
class QueueScope extends State.Scope(QueueResource)("@scope/queue/QueueScope", { queueId: Schema.String }) {}
class QueueScopeTel extends QueueScope.telemetry({ inFlight: Telemetry.metric.gauge, lastPriority: Schema.Number }) {}

class EntryScope extends QueueScopeTel.withLeaf("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}
class EntryScopeTel extends EntryScope.telemetry({ attemptsSoFar: Schema.Number }) {}
```
- **Every scope identity carries an id** — `State.Scope(domain)(id, fields)` (root) and `.withLeaf(name, fields)(id)` (child) both take one; all or none, and we chose all.
- `.telemetry({…})` → same scope's hidden half (**no new id — derives the base's**). **`State.Tag` ops open the BASE scope; the `…Tel` scope belongs to the Telemetry layer (schemas read state via it).** Process view (`ctx.scope`) hides the telemetry half.
- inline single-use leaf: `State.leaf("Name", { … })` as an op's scope arg.

### 2.2 The Tag
```ts
class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueState",
  Telemetry.namespace("Queue")(
    Telemetry.group("Lifecycle")("Started", "Paused"),             // standalone events
    Telemetry.group("Entry")(
      State.operation("enqueue", EntryScope)(Telemetry.exit("Enqueued", "Rejected")),
      State.operation("processEntry", EntryScope, ProcessInput)(
        "Started",
        State.inner(
          "Retried",
          State.operation("rateLimit")(Telemetry.exit(Telemetry.failure(Telemetry.declare("RateLimit", "Exceeded")))),
        ),
        ["Completed", "Released", "Failed"],
      ),
    ),
  ),
) {}
```
- `State.Tag<Self>(domain)(facetId, …parts)`; parts = `Telemetry.namespace`/`Telemetry.group` wrappers (ref-shorteners). **One namespace per Tag** (🔶 multiple namespaces deferred — §8). Domain in 1st call, facetId 1st arg of 2nd. **`State.operation` is the State anchor; legs/events are `Telemetry.*`.**
- **Operation ≠ event:** an operation **wraps work** (span + lifecycle); a bodiless "op" is an **event**. `start-only` = work whose start you record.
- **Op↔scope via Effect `R`:** `State.operation(name, Leaf)` requires `Leaf`'s parent in `R`, provides `Leaf`; top-level op → kernel provides root; nested op opening a descendant → satisfied by the enclosing op. `State.operation(name)` inherits ambient. Unsatisfied parent = type error.
- **Operation input is a `Schema`** (so it's pullable into schemas): `State.operation(name, scope, InputSchema)`; passed at call as `op(input).provide(scope)`; `ctx.input`.
- **Parts triad** (type-distinct): `(start, inner, exit)` + duals + singles. start = bare string / `Telemetry.declare` / `Telemetry.start`; inner = `State.inner(…)`; exit = bare array / `Telemetry.exit(…)`.
- **`State.inner`** = the `ctx.telemetry` surface (middle events, nested ops, **group-import**). Typed collisions = compile error; `ctx.telemetry = inner − this op's own start/exit`.
- **Group-import into `inner`** — events already declared in another (sibling) group, pulled onto `ctx.telemetry` of *this* op **without redeclaring them**:
  - `Telemetry.spread(G)` — **flat-import**: drops the group prefix → `ctx.telemetry.Event`.
  - `Telemetry.group(G)` — **nested-import**: keeps the group → `ctx.telemetry.Group.Event`.
  - `G` references an existing group (its name within the namespace; full `"Namespace.Group"` only matters once multi-namespace lands — §8). Spread never *creates* a group.
- **`Telemetry.exit`** = the 3 free Cause-fold outcomes (success / interrupted / failure); positional shorthand (`"Completed", "Failed"`) or `Telemetry.success`/`interrupted`/`failure` wrappers (no object/`onSuccess` form). **No schemas on these legs** — exit-event schemas live in the tree (§3), keyed by event name.
- **Ref-shorteners** (`Telemetry.namespace`/`Telemetry.group`): bare strings resolve to the enclosing group; cross-group/namespace via `Telemetry.declare`. Never appear in handles.
- **Handles:** ops flat by op name; standalone events are always **grouped** (every wire is `Namespace.Group.Event` — there is no ungrouped event); names unique per Tag; nested ops + middle events + imported events are on `ctx.telemetry`, not the Tag.

### 2.3 Long form — every form & feature
```ts
// extra scopes for the catalog
class AttemptScope extends EntryScope.withLeaf("Attempt", { attempt: Schema.Number })("@scope/queue/AttemptScope") {}

class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueState",
  Telemetry.namespace("Queue")(
    Telemetry.group("Lifecycle")("Started", "Paused"),                  // grouped standalone events
    Telemetry.group("Audit")("Granted", "Denied"),                      // sibling group (imported below)
    Telemetry.group("Entry")(
      State.operation("enqueue", EntryScope)(                           // exit-only, explicit
        Telemetry.exit(
          Telemetry.success("Enqueued"),
          Telemetry.failure("Rejected"),
        ),
      ),
      State.operation("admit", EntryScope)(Telemetry.start("Admitted")), // start-only, explicit
      State.operation<{ batchSize: number }>("drainAll", EntryScope)(    // input as a TS type
        Telemetry.start("Drained"),
      ),
      State.operation("processEntry", EntryScope, ProcessInput)(         // input as a Schema
        Telemetry.start("Started"),
        State.inner(
          "Retried",                                                     // middle event
          State.operation("rateLimit")(                                  // nested op, inherits Entry
            Telemetry.exit(Telemetry.failure(Telemetry.declare("RateLimit", "Exceeded"))),
          ),
          State.operation("attempt", AttemptScope)(["Succeeded", "Failed"]), // nested op opens a descendant leaf
          State.operation("checkpoint", State.leaf("Checkpoint", { at: Schema.Number }))(["Saved"]), // inline single-use leaf
          Telemetry.group("Audit"),                                     // nested-import → ctx.telemetry.Audit.{Granted,Denied}
          Telemetry.spread("Audit"),                                    // flat-import   → ctx.telemetry.{Granted,Denied}
        ),
        Telemetry.exit(
          Telemetry.success("Completed"),
          Telemetry.interrupted("Released"),
          Telemetry.failure("Failed"),
        ),
      ),
    ),
  ),
) {}
```

### 2.4 Short form — same Tag, bare-string sugar
```ts
class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueState",
  Telemetry.namespace("Queue")(
    Telemetry.group("Lifecycle")("Started", "Paused"),
    Telemetry.group("Audit")("Granted", "Denied"),
    Telemetry.group("Entry")(
      State.operation("enqueue", EntryScope)(["Enqueued", "Rejected"]),  // bare array = exit
      State.operation("admit", EntryScope)("Admitted"),                  // bare string = start
      State.operation<{ batchSize: number }>("drainAll", EntryScope)("Drained"),
      State.operation("processEntry", EntryScope, ProcessInput)(
        "Started",                                                       // bare string = start
        State.inner(
          "Retried",
          State.operation("rateLimit")(Telemetry.exit(Telemetry.failure(Telemetry.declare("RateLimit", "Exceeded")))),
          State.operation("attempt", AttemptScope)(["Succeeded", "Failed"]),
          State.operation("checkpoint", State.leaf("Checkpoint", { at: Schema.Number }))(["Saved"]),
          Telemetry.spread("Audit"),                                     // flat-import sibling group → ctx.telemetry.{Granted,Denied}
        ),
        ["Completed", "Released", "Failed"],                             // bare array = exit (success, interrupted, failure positional)
      ),
    ),
  ),
) {}
```
- **start sugar:** bare `"Name"` ≡ `Telemetry.start("Name")`.
- **exit sugar:** bare `["A","B","C"]` ≡ `Telemetry.exit(success "A", interrupted "B", failure "C")` positionally (1 = success-only; 2 = success+failure; 3 = success+interrupted+failure).
- explicit combinators are only needed to **reorder/skip** outcomes, attach a `(e)=>schema`, or `declare` cross-group.

---

## 3. Event schemas & `Telemetry.Tag` (compose) ✅

**Events carry ONLY what their schema specifies — nothing is automatic, not even scope.** Every field you want — *including* scope identity (`entryId`, `runId`) — must be listed in the schema (or inherited from the schema it extends / the group `default`), via `e.root.X` / `e.leaf.X` / `e.input.X` / `e.exit.X` / `e.clock`, or a plain `Schema` (PlainField, bound at wiring). **No schema entry + no group `default` = empty payload.** There is no auto-scope; `runId` in an event means a schema wrote `runId: e.root.runId`.

### 3.1 The schema tree
Compose path: `Telemetry.Tag(StateTag, GlobalBase?)(telId, schemaTree)` — its **own required id** (distinct from the `State.Tag`'s), then a **wire-keyed tree** (`Namespace → Group → Event`). `Telemetry.Tag` derives its **telemetry scopes from the schemas** (no scope args). The tree is **sparse** — only the group `default` + events that add extras; **default-only events are omitted** (they're enumerated in `State.Tag`, and resolve to the `default`).

- **Global base (optional 2nd arg):** a scope-free `Telemetry.Schema` (`runId`, `at`, …) **auto-merged into every event** — no per-schema `extend`. Merge order per event: **global base ⊕ group `default` ⊕ the event's own entry**. Universal fields go here once; group `default`s/entries only add what's beyond it.

### 3.2 Event entry forms
| form | meaning |
|---|---|
| *(omitted)* | resolves to the group `default` |
| `Base` | a reusable base, as-is (no extras) |
| `Base.extend((e) => ({ … }))` | **extend** a base with extras — the form for adding fields (no bare-arrow shorthand) |
| `ScopeTel.event((e) => ({ … }))` | plain, scope-bound (no base) |

**You always extend a schema — a bare `(e) => ({ … })` is not a valid entry.** To add fields you write `Base.extend((e) => …)`; an event with no extras is `Base`; omitted resolves to the group `default`.

### 3.3 `default` (group base)
- `default: <schema>` — a scope-bound base (`Telemetry.Schema(ScopeTel)` class, or `ScopeTel.event((e) => …)`). **Reserved key — no event named `default`.**
- omitted events → `default`; to add extras you **extend** the base (`EntryEvent.extend((e) => …)`); `Base`/`ScopeTel.event` set the base explicitly. A bare `(e) => extras` is **not** a valid entry.
- a group with **no** `default` and an omitted event → empty/error (exhaustiveness check vs `State.Tag`).
- 🔶 namespace-level default (root-scoped, layered above group) — deferred.

### 3.4 `e` (the context)
`e.root` (navigable scope tree — root fields + telemetry + nested branches; reachability gated by intersection), `e.leaf` (current deepest leaf), `e.input`, `e.exit.*` (exit events only), `e.clock`, `e.runId` (ambient run identity — needs no scope). **No `e.state`** — telemetry merges into `e.root`/`e.leaf` per level; persistent/comparison state lives at root (leaf is transient). Types inferred from sources; PlainFields carry their own `Schema`.

### 3.5 Reusable bases
- `Telemetry.Schema<Self>(ScopeTel)((e) => …)` — reusable, scope-bound base.
- `Telemetry.Schema<Self>()((e) => …)` — **scope-free base** (ambient only: `e.runId` / `e.clock`); the form used for the global base.
- `.Schema(ScopeTel)((e) => …)` — extend into another reusable base.
- finalize as an event: `Base` (as-is) / `Base.extend((e) => …)` (base + extras); inline value `ScopeTel.event((e) => …)`.
- **Template slot** = a plain `Schema.X` in a base; a later merge resolves it with an assignable source, else it stays a PlainField. **Extension is a flat merge at creation** — no chain.
- **Casing:** `.Schema` (uppercase) = reusable class; `.extend` / `.event` (lowercase) = inline schema value.
- *(`Telemetry.Event(Tag, "id")` per-event classes — **dropped** in favor of the tree.)*

### 3.6 Full Example 1 (compose)
```ts
import { Schema } from "effect"
import { State, Telemetry } from "@nikscripts/effect-pm"
import { QueueResource } from "../QueueResource"

// base scopes (State.Tag operations) — every identity carries an id
class QueueScope extends State.Scope(QueueResource)("@scope/queue/QueueScope", { queueId: Schema.String }) {}
class EntryScope extends QueueScope.withLeaf("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}

// telemetry scopes (state half) — used by the Telemetry layer
class QueueScopeTel extends QueueScope.telemetry({ inFlight: Telemetry.metric.gauge, lastPriority: Schema.Number }) {}
class EntryScopeTel extends EntryScope.telemetry({ attemptsSoFar: Schema.Number }) {}

// operation input (Schema per C — feeds Entry.Started)
const ProcessInput = Schema.Struct({ priority: Schema.Number, attempts: Schema.Number })

// State.Tag — structure; BASE scopes; bare names (short form)
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

// global base — scope-free; auto-merged into every event (runId + at everywhere, no extend)
class BaseEvent extends Telemetry.Schema<BaseEvent>()((e) => ({
  runId: e.runId,
  at: e.clock,
})) {}

// reusable group-default bases — only add beyond the global base
class EntryEvent extends Telemetry.Schema<EntryEvent>(EntryScopeTel)((e) => ({
  entryId: e.leaf.entryId,
})) {}
class LifecycleEvent extends Telemetry.Schema<LifecycleEvent>(QueueScopeTel)((e) => ({
  queueId: e.root.queueId,
})) {}

// richer Tag — global base 2nd arg; sparse schema tree; scopes derived from the schemas
class QueueTelemetry extends Telemetry.Tag<QueueTelemetry>(QueueOps, BaseEvent)(
  "@scope/queue/QueueTelemetry",
  {
  Queue: {
    Lifecycle: {
      default: LifecycleEvent,
      // Started, Paused → default
    },
    Entry: {
      default: EntryEvent,
      Rejected:  EntryEvent.extend((e) => ({ reason: Schema.String })),
      Started:   EntryEvent.extend((e) => ({ priority: e.input.priority, inFlight: e.root.inFlight })),
      Retried:   EntryEvent.extend((e) => ({ attempts: e.leaf.attemptsSoFar })),
      Completed: EntryEvent.extend((e) => ({ durationMs: e.exit.duration, attempts: e.leaf.attemptsSoFar })),
      Failed:    EntryEvent.extend((e) => ({ durationMs: e.exit.duration, cause: e.exit.cause, reason: Schema.String })),
      // Enqueued, Released → default
    },
    RateLimit: {
      default: EntryEvent, // rateLimit inherits Entry scope
      // Exceeded → default
    },
  },
}) {}
```

### 3.7 File layout (compose)
Two files, split on the State/Telemetry seam: **base (state) scopes bundle with `State.Tag`**; **telemetry scopes bundle with the event schemas**.

```ts
// QueueOps.ts — base scopes + State.Tag (structure)
export class QueueScope extends State.Scope(QueueResource)("@scope/queue/QueueScope", { queueId: Schema.String }) {}
export class EntryScope extends QueueScope.withLeaf("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}
export const ProcessInput = Schema.Struct({ priority: Schema.Number, attempts: Schema.Number })
export class QueueOps extends State.Tag<QueueOps>(QueueResource)( /* …namespace/groups/ops… */ ) {}

// QueueTelemetry.ts — telemetry scopes + schemas + Telemetry.Tag (compose)
import { QueueScope, EntryScope, QueueOps } from "./QueueOps"
export class QueueScopeTel extends QueueScope.telemetry({ inFlight: Telemetry.metric.gauge, lastPriority: Schema.Number }) {}
export class EntryScopeTel extends EntryScope.telemetry({ attemptsSoFar: Schema.Number }) {}
export class BaseEvent extends Telemetry.Schema<BaseEvent>()((e) => ({ runId: e.runId, at: e.clock })) {}
export class EntryEvent extends Telemetry.Schema<EntryEvent>(EntryScopeTel)((e) => ({ entryId: e.leaf.entryId })) {}
export class LifecycleEvent extends Telemetry.Schema<LifecycleEvent>(QueueScopeTel)((e) => ({ queueId: e.root.queueId })) {}
export class QueueTelemetry extends Telemetry.Tag<QueueTelemetry>(QueueOps, BaseEvent)("@scope/queue/QueueTelemetry", { /* …tree… */ }) {}
```

**Identifiers:** `State.Tag` and `Telemetry.Tag` each carry their **own required id**, distinct — convention `<Resource>/<Name>` (`"@scope/queue/QueueState"` for the State.Tag, `"@scope/queue/QueueTelemetry"` for the Telemetry.Tag). Compose's `Telemetry.Tag` takes its `telId` as the first arg of the 2nd call (before the tree); Bundle's is the first arg before the structure.

**Naming:** the two `Telemetry.Tag` shapes are **Compose** (over a standalone `State.Tag`) and **Bundle** (single tag). No "Form 1 / Form 2". Method inventory: [telemetry-api-surface.md](./telemetry-api-surface.md).

---

## 4. `Telemetry.Tag` (bundle) ✅

One `Telemetry.Tag` call, **no separate `State.Tag` and no separate schema tree.** **Does not use `State.Tag`.** Shape: `Telemetry.Tag(domain, GlobalBase?)(facetId, structure)`. Same scopes, global base, and merge order as compose (**global ⊕ group `default` ⊕ inline schema**) — the only difference is **schemas attach inline at each event**, not in a wire-keyed tree.

**Where schemas attach (the bundle's distinguishing mechanism):**
- **group `default`** — 2nd arg of `Telemetry.group(name, DefaultBase)`.
- **start** — `Telemetry.start(name, schema?)`.
- **exit** — `Telemetry.success(name, schema?)` / `Telemetry.interrupted(name, schema?)` / `Telemetry.failure(name, schema?)`.
- **inner (middle) event** — `Telemetry.event(name, schema?)`.
- **bare name** (string, or `name` with no schema arg) → the group `default`.
- schema arg is always a §3.2 form (`Base` / `Base.extend((e) => …)` / `ScopeTel.event((e) => …)`) — **never a bare arrow**.

**Multi-placement dedup** — `Telemetry.declare(name, schema)` declares the event **once with its schema**; every other placement references it by **identifier only** (bare name / `Telemetry.event(name)`) — the schema is never repeated (§1).

```ts
// scopes / global base / group bases — identical to §3.6
class QueueScope extends State.Scope(QueueResource)("@scope/queue/QueueScope", { queueId: Schema.String }) {}
class EntryScope extends QueueScope.withLeaf("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}
class QueueScopeTel extends QueueScope.telemetry({ inFlight: Telemetry.metric.gauge, lastPriority: Schema.Number }) {}
class EntryScopeTel extends EntryScope.telemetry({ attemptsSoFar: Schema.Number }) {}
const ProcessInput = Schema.Struct({ priority: Schema.Number, attempts: Schema.Number })

class BaseEvent extends Telemetry.Schema<BaseEvent>()((e) => ({ runId: e.runId, at: e.clock })) {}
class EntryEvent extends Telemetry.Schema<EntryEvent>(EntryScopeTel)((e) => ({ entryId: e.leaf.entryId })) {}
class LifecycleEvent extends Telemetry.Schema<LifecycleEvent>(QueueScopeTel)((e) => ({ queueId: e.root.queueId })) {}

// bundle — structure + schemas inline; global base is the 2nd arg of the 1st call
class QueueTelemetry extends Telemetry.Tag<QueueTelemetry>(QueueResource, BaseEvent)(
  "@scope/queue/QueueTelemetry",
  Telemetry.namespace("Queue")(
    Telemetry.group("Lifecycle", LifecycleEvent)("Started", "Paused"),            // default 2nd arg; both → default
    Telemetry.group("Entry", EntryEvent)(                                         // group default = EntryEvent
      State.operation("enqueue", EntryScope)(
        Telemetry.exit(
          Telemetry.success("Enqueued"),                                          // bare → default
          Telemetry.failure("Rejected", EntryEvent.extend((e) => ({ reason: Schema.String }))),
        ),
      ),
      State.operation("processEntry", EntryScope, ProcessInput)(
        Telemetry.start("Started", EntryEvent.extend((e) => ({ priority: e.input.priority, inFlight: e.root.inFlight }))),
        State.inner(
          Telemetry.event("Retried", EntryEvent.extend((e) => ({ attempts: e.leaf.attemptsSoFar }))),
          State.operation("rateLimit")(
            Telemetry.exit(Telemetry.failure(Telemetry.declare("RateLimit", "Exceeded"))),  // name-only; RateLimit default applies
          ),
        ),
        Telemetry.exit(
          Telemetry.success("Completed", EntryEvent.extend((e) => ({ durationMs: e.exit.duration, attempts: e.leaf.attemptsSoFar }))),
          Telemetry.interrupted("Released"),                                       // bare → default
          Telemetry.failure("Failed", EntryEvent.extend((e) => ({ durationMs: e.exit.duration, cause: e.exit.cause, reason: Schema.String }))),
        ),
      ),
    ),
  ),
) {}
```

**Multi-placement** (an event emitted from several sites — declare once, reference by id):
```ts
// declare once, with the schema
Telemetry.declare("Entry.Retried", EntryEvent.extend((e) => ({ attempts: e.leaf.attemptsSoFar })))
// elsewhere — identifier only, schema reused:
Telemetry.event("Retried")        // inner
"Retried"                          // bare, where a name is accepted
```

Compose vs bundle: same scopes/global base/merge order/wire rules; **compose** keeps a separate `State.Tag` + wire-keyed schema tree (§3), **bundle** inlines structure + schemas into one `Telemetry.Tag` and uses `declare` for cross-site dedup. (`Telemetry.default(…)` as a leg part is still **not** a thing — the default is `Telemetry.group(name, Default)`.)

---

## 5. Emission & calling ✅

```ts
// runtime boundary — root scope once
queueRuntime.pipe(Effect.provide(QueueScope.layer({ queueId })))

yield* QueueTelemetry.Lifecycle.Started                         // standalone event (root ambient)
yield* admitItem(item).pipe(QueueTelemetry.enqueue.provide({ entryId }))  // op wraps work

yield* QueueTelemetry.processEntry({ priority, attempts }).provide({ entryId }).pipe(
  Effect.flatMap((ctx) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runHandler(item).pipe(ctx.telemetry.rateLimit))  // nested op
      if (shouldRetry(exit)) yield* ctx.telemetry.Retried                              // middle event
      return yield* exit
    }),
  ),
)
```

- **Two verbs:** wrap an op around work (`op.provide(scope)`), drop an event at a point (`yield* X` / `.pipe(X)`).
- **Two emit categories:** positional (start, inner events, catch-arm events — author-placed) and outcome (success + unhandled failure — synthesized from the `Exit`). Specific handled failures ride your `catchTag` arms.
- **`.pipe(Event)` = emit-first** (`Effect.zipRight(emit, self)`); unconditional, preserves outcome.
- **Runner Cause fold** (v4 `Cause` is a flat mixed `reasons[]`): `isSuccess` → success; `hasInterruptsOnly` → interrupted; else failure (+ durationMs, first `findErrorOption._tag`, interrupt-in-mix).
- **`ctx = { input, telemetry, scope }`** — `telemetry` = the `inner` surface; `scope` = active branch path (process-visible only).

---

## 6. Scope, state & nesting ✅

### 6.1 Context model
Scope = `Context` services; the scope tag owns its segment (SSOT). Per-op leaf = lightweight `provideService`-style add; `Layer` only for lifetime roots. (Reverted the Ref/`branchStack` model.) Fork-inheritance + cleanup native, so `Effect.all`/`fork`/`race` behave.

### 6.2 Snapshot multi-branch, reads path-local
- **Snapshot (observer view): open-struct, multi-branch** — siblings can coexist in `State.Root`/`State.Changed`; `previous` multi-branch too.
- **Scope reads + user-event materialization: path-local** — `ctx.scope` and every user event see root → that op's own leaf chain only.
- **Multi-branch awareness confined to the reserved `Internal.State.Changed` / snapshot machinery.** Cross-sibling correlation in a normal event → thread via operation input.

### 6.3 Nesting
Scopes and operations nest infinitely (descendant nesting **essential**, kept). Wire stays one segment (innermost leaf) at any depth. Nested ops live on `ctx.telemetry`.

### 6.4 Surviving constraints
- **Same-branch multiplicity on one fiber = silent shadow/overwrite** — fork a fiber each, or model the slot as a keyed collection. 🔶 default.
- **An event needs its scope active to materialize.**

### 6.5 Telemetry state (the hidden scope half)
General telemetry-owned typed state (via `.telemetry({…})` on the scope), kernel-blind, read into events:
- **aggregates** (counts/gauges) — also projected to **`Metric`** for OTLP export.
- **remembered / comparison state** (last value, deltas) — what `Metric` can't do (e.g. `lastPriority` on the root to compare entry-to-entry).

Read via `e.root`/`e.leaf`; write via wiring (`Telemetry.update` / event-leg — 🔶 shape). `Metric` is the **export of the aggregate subset**, not a replacement. Build state features as needed. **Materialization set:** visible scope + telemetry state + operation input + `Exit.*` + terminals — all path-local, intersected per §1.1.

### 6.6 `State.Changed.operation` ⚠️
Rebuilt from the structural tree as **leaf-path + op-path** (`Entry/processEntry`, `Entry/processEntry/rateLimit`, root op = `enqueue`). Format/separator/nested rendering TBD.

---

## 7. `Telemetry.Service` + Effect-primitive backing ✅

`Telemetry.Service(Tag, wiring)` = Tag + **wiring** + **layer** → runtime. Wiring (server-only) binds PlainFields, telemetry-state writes, log legs, sink config — **never imported by the client**.

**Who imports what:** client/RPC → `Telemetry.Tag` (shapes), never wiring; server → Tag + wiring + Service.

| Bespoke | Effect primitive |
|---|---|
| op timing/status | `Effect.withSpan` |
| telemetry-state **export** | `Metric` (fed from the hidden half) |
| `State.Root` + transition + fan-out | `SubscriptionRef` (`.changes`) |
| router fan-out | `PubSub` + `Stream` |
| log legs | `Logger` |
| scope storage | `Context` |
| schemas | `Schema` |
| transport / broadcast | `effect/unstable/rpc` (+ `http`/`socket`) |

Adjacent: durable archive → `@effect/sql` (`sql-sqlite-node` installed); OTLP → `@effect/opentelemetry` (not installed); avoid `@effect/experimental` unless event-sourcing needed. **Ship one sink first.**

---

## 8. Open / deferred

🔶 Still to settle:
- **wiring layer** — `bind` (fills PlainFields), telemetry-state writes, log legs, exhaustiveness. *Next layer.*
- schema minor bits (keying, exhaustiveness vs `State.Tag`); `State.Changed.operation` format (§6.6); same-branch default (§6.4); foreign-emit policy; `op.provide` operator+builder typing; namespace-level default (§3.3).

🔶 Deferred (build on demand): `import`/predefined `wires`; extra sinks; advanced telemetry-state features; **multiple namespaces per Tag** (one namespace per Tag for now).

✅ Resolved: module split (`State` structure / `Telemetry` observability); inferred wire-tree + `declare`; path-local intersection; op↔scope via `R`; inline `leaf`; descendant nesting; operation ≠ event; operation input as `Schema`; triad + `inner`; sibling group-import into `inner` (`Telemetry.spread` flat / `Telemetry.group` nested); flat handles; multi-branch snapshot + path-local reads; telemetry state on extended scopes (`Metric` = export); event reuse + intersection; interrupt optional; **event schemas** — *events carry only what the schema specifies (no auto-scope)*; **wire-keyed schema tree** with group `default` + sparse/omitted entries, scopes derived from schemas; reusable bases (`Telemetry.Schema(Scope)`, `.Schema` extend, `Base`/`Base.extend`/`ScopeTel.event`, template slots, flat-merge); `Telemetry.Event` per-event classes **dropped**; **compose `Telemetry.Tag(StateTag, GlobalBase?)(telId, tree)` (Example 1) locked**; **State.Tag + Telemetry.Tag each carry their own required, distinct id** (`<Resource>/QueueState` vs `<Resource>/QueueTelemetry`); **every scope identity carries an id** (root + leaf; `.telemetry` derives); **optional global base** (scope-free `Telemetry.Schema()`, `e.runId`/`e.clock`) auto-merged into every event (global ⊕ group `default` ⊕ entry); `declare` is name-only in compose, schema-carrying in the bundle (define multi-placement events once, reference by id); `Telemetry.Service` = + layer; **bundle `Telemetry.Tag(domain, GlobalBase?)(facetId, structure)` (Example 2) locked — schemas inline on legs** (`Telemetry.start/success/interrupted/failure/event(name, schema?)`, group default = `Telemetry.group(name, Default)`), no separate tree; `declare(name, schema)` for cross-site dedup.

---

## 9. Package reality (verified)
- core `effect@4.0.0-beta.76`: `Metric`, `Tracer`+`withSpan`, `Logger`, `SubscriptionRef`, `PubSub`, `Stream`, `Context`, `Schema`; `Cause` = flat `reasons[]`; `Exit` = `Success | Failure(Cause)`; RPC/http/socket under `effect/unstable/*`.
- installed adjacent: `@effect/platform-node` (+ shared), `@effect/sql-sqlite-node`.
- not installed: `@effect/opentelemetry`, `@effect/experimental`, `@effect/cluster`, `@effect/workflow`.
