# Telemetry redesign — working decisions

**Status:** Active redesign (Jun 2026). **Capture doc** — what's agreed in the API bake. The authoring surface (State.Tag → Telemetry.Tag, scopes, schemas) is essentially complete; wiring + runtime remain. Loose ends flagged **OPEN** / **NEEDS ATTENTION**.

**Supersedes the framing of:** [telemetry-tag-state-wiring-api-handoff.md](./telemetry-tag-state-wiring-api-handoff.md).

**Grounding:** `effect@4.0.0-beta.76` (verified against installed source — vendored `repos/effect` is stale v3).

**Legend:** ✅ DECIDED · 🔶 OPEN · ⚠️ NEEDS ATTENTION

---

## 0. Module split & layering ✅

The structural layer lives in **`State`**; the observability layer in **`Telemetry`**. Three layers, named so the module tells you which one you're at:

```
State.Tag(…)                                  → bare structure: ops, scopes, handles, spans. No schemas. No-op without a layer.
  Telemetry.Tag(StateTag)(schemaTree)         → richer tag: + schema tree + state            (compose — §3, locked)
  Telemetry.Tag(domain)(facetId, structure, schemaTree)  → richer tag, one definition          (bundle — §4, locked)
Telemetry.Service(Tag, wiring)                → runtime: + wiring + layer
```

| Layer | Names |
|---|---|
| **State** (operations, scopes) | `State.Tag`; `State.operation`; `State.inner`; `State.leaf`; `State.Scope` → `.withLeaf` → `.telemetry({…})` |
| **Telemetry** (events, taxonomy, schemas) | `Telemetry.namespace` / `Telemetry.group`; `Telemetry.event` / `Telemetry.declare`; `Telemetry.start` / `Telemetry.exit`; `Telemetry.success` / `interrupted` / `failure`; `Telemetry.spread`; `Telemetry.Tag` (richer, two ways); `Telemetry.Event` / `Schema` / `Schemas`; `Telemetry.metric.*`; `Telemetry.Service`; schema context `e.root` / `e.leaf` / `e.input` / `e.exit` / `e.clock` |

- **State** owns `operation`, `inner` (the `ctx.telemetry` container — holds nested ops + middle events), scopes. **Telemetry** owns events, taxonomy, legs (`start`/`exit`), schemas.
- **`start`/`exit` use the bare `State.Tag` API** (`"Started"` / `["Completed","Failed"]` / `Telemetry.start` / `Telemetry.exit`) — **no inline schemas on legs**. **`Telemetry.event` (with optional inline schema) is for inner events only.**
- **`State.Tag` has no schemas** (optional telemetry: provide no layer → no-op; client-cheap).
- **`Telemetry.Tag` has schemas + state shape** — the client/RPC contract.
- **`Telemetry.Service`** = Tag + wiring + layer; "Service" implies the layer, so it's *not* used for the schema-only tag.

Pipeline: wire strings → `State.Tag` adds per-placement scope → `Telemetry.Tag` schemas type field access → runtime backed by Effect primitives (spans, `Metric`, `SubscriptionRef`, `PubSub`, `Context`, `unstable/rpc`).

---

## 1. Wire tree ✅

A wire is **three strings** — `Namespace.Group.Event`. **Inferred** from declarations (default) or imported. Entry points:

- **bare string** — event in the **enclosing `Telemetry.group`**.
- **`Telemetry.declare(…)`** — names cross-group/namespace events **and/or defines shared events once** (referenced by bare name elsewhere; explicit, order-independent):
  ```ts
  Telemetry.declare("RateLimit", "Exceeded")                            // name ref
  Telemetry.declare("ExitGroup", ["Success", "Interrupted", "Failed"])  // multiple name refs
  Telemetry.declare("Entry", { Completed: (e) => …, Failed: (e) => … }) // define shared events + schemas
  Telemetry.declare("Entry.Retried", (e) => …)                          // single, dotted path
  ```
  **No dotted refs as values** (inferred → nothing to dot into); cross-namespace via `"Namespace.Group.Event"` / `("Namespace", "Group", …)`.
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
class QueueScope extends State.Scope(QueueResource)({ queueId: Schema.String }) {}
class QueueScopeTel extends QueueScope.telemetry({ inFlight: Telemetry.metric.gauge, lastPriority: Schema.Number }) {}

class EntryScope extends QueueScopeTel.withLeaf("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}
class EntryScopeTel extends EntryScope.telemetry({ attemptsSoFar: Schema.Number }) {}
```
- `.withLeaf(name, fields)(id)` → child scope (new identity).
- `.telemetry({…})` → same scope's hidden half (no id). **`State.Tag` ops open the BASE scope; the `…Tel` scope belongs to the Telemetry layer (schemas read state via it).** Process view (`ctx.scope`) hides the telemetry half.
- inline single-use leaf: `State.leaf("Name", { … })` as an op's scope arg.

### 2.2 The Tag
```ts
class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueTelemetry",
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
- **`Telemetry.exit`** = the 3 free Cause-fold outcomes (success / interrupted / failure); existing positional shorthand (`"Completed", "Failed"`) or `Telemetry.success`/`interrupted`/`failure` wrappers; **each combinator gains an optional trailing `(e) => schema`** (no object/`onSuccess` form).
- **Ref-shorteners** (`Telemetry.namespace`/`Telemetry.group`): bare strings resolve to the enclosing group; cross-group/namespace via `Telemetry.declare`. Never appear in handles.
- **Handles:** ops flat by op name; standalone events are always **grouped** (every wire is `Namespace.Group.Event` — there is no ungrouped event); names unique per Tag; nested ops + middle events + imported events are on `ctx.telemetry`, not the Tag.

### 2.3 Long form — every form & feature
```ts
// extra scopes for the catalog
class AttemptScope extends EntryScope.withLeaf("Attempt", { attempt: Schema.Number })("@scope/queue/AttemptScope") {}

class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueTelemetry",
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
  "@scope/queue/QueueTelemetry",
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
Compose path: `Telemetry.Tag(StateTag)(schemaTree)` — a **wire-keyed tree** (`Namespace → Group → Event`). `Telemetry.Tag` derives its **telemetry scopes from the schemas** (no scope args). The tree is **sparse** — only the group `default` + events that add extras; **default-only events are omitted** (they're enumerated in `State.Tag`, and resolve to the `default`).

### 3.2 Event entry forms
| form | meaning |
|---|---|
| *(omitted)* | resolves to the group `default` |
| `(e) => ({ … })` | group `default` + these extras |
| `Base` | a reusable base, as-is (no extras) |
| `Base.extend((e) => ({ … }))` | base + extras (overrides the group default's base) |
| `ScopeTel.event((e) => ({ … }))` | plain, scope-bound (no base) |

### 3.3 `default` (group base)
- `default: <schema>` — a scope-bound base (`Telemetry.Schema(ScopeTel)` class, or `ScopeTel.event((e) => …)`). **Reserved key — no event named `default`.**
- omitted events → `default`; listed `(e) => extras` → `default` + extras; `Base.extend`/`ScopeTel.event` → override the default's base.
- a group with **no** `default` and an omitted event → empty/error (exhaustiveness check vs `State.Tag`).
- 🔶 namespace-level default (root-scoped, layered above group) — deferred.

### 3.4 `e` (the context)
`e.root` (navigable scope tree — root fields + telemetry + nested branches; reachability gated by intersection), `e.leaf` (current deepest leaf), `e.input`, `e.exit.*` (exit events only), `e.clock`. **No `e.state`** — telemetry merges into `e.root`/`e.leaf` per level; persistent/comparison state lives at root (leaf is transient). Types inferred from sources; PlainFields carry their own `Schema`.

### 3.5 Reusable bases
- `Telemetry.Schema<Self>(ScopeTel)((e) => …)` — reusable, scope-bound base.
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

// base scopes (State.Tag operations)
class QueueScope extends State.Scope(QueueResource)({ queueId: Schema.String }) {}
class EntryScope extends QueueScope.withLeaf("Entry", { entryId: Schema.String })("@scope/queue/EntryScope") {}

// telemetry scopes (state half) — used by the Telemetry layer
class QueueScopeTel extends QueueScope.telemetry({ inFlight: Telemetry.metric.gauge, lastPriority: Schema.Number }) {}
class EntryScopeTel extends EntryScope.telemetry({ attemptsSoFar: Schema.Number }) {}

// operation input (Schema per C — feeds Entry.Started)
const ProcessInput = Schema.Struct({ priority: Schema.Number, attempts: Schema.Number })

// State.Tag — structure; BASE scopes; bare names (short form)
class QueueOps extends State.Tag<QueueOps>(QueueResource)(
  "@scope/queue/QueueTelemetry",
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

// reusable group-default bases
class EntryEvent extends Telemetry.Schema<EntryEvent>(EntryScopeTel)((e) => ({
  entryId: e.leaf.entryId,
  at: e.clock,
})) {}
class LifecycleEvent extends Telemetry.Schema<LifecycleEvent>(QueueScopeTel)((e) => ({
  queueId: e.root.queueId,
  at: e.clock,
})) {}

// richer Tag — sparse schema tree; scopes derived from the schemas
class QueueTelemetry extends Telemetry.Tag<QueueTelemetry>(QueueOps)({
  Queue: {
    Lifecycle: {
      default: LifecycleEvent,
      // Started, Paused → default
    },
    Entry: {
      default: EntryEvent,
      Rejected:  (e) => ({ reason: Schema.String }),
      Started:   (e) => ({ priority: e.input.priority, inFlight: e.root.inFlight }),
      Retried:   (e) => ({ attempts: e.leaf.attemptsSoFar }),
      Completed: (e) => ({ durationMs: e.exit.duration, attempts: e.leaf.attemptsSoFar }),
      Failed:    (e) => ({ durationMs: e.exit.duration, cause: e.exit.cause, reason: Schema.String }),
      // Enqueued, Released → default
    },
    RateLimit: {
      default: EntryEvent, // rateLimit inherits Entry scope
      // Exceeded → default
    },
  },
}) {}
```

---

## 4. `Telemetry.Tag` (bundle) ✅

Same as compose (§3), but the **structure is inlined** into the `Telemetry.Tag` call instead of a separate `State.Tag`. **Schemas are the identical tree** (§3 forms: `default`, `(e) => extras`, `Base`, `Base.extend`, `ScopeTel.event`, omit) — **never on legs.** Shape: `Telemetry.Tag(domain)(facetId, structure, schemaTree)`.

```ts
class QueueTelemetry extends Telemetry.Tag<QueueTelemetry>(QueueResource)(
  "@scope/queue/QueueTelemetry",
  // structure (inlined; same as State.Tag — base scopes, bare names)
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
  // schema tree (identical forms to §3.6)
  {
    Queue: {
      Lifecycle: { default: LifecycleEvent },
      Entry: {
        default: EntryEvent,
        Rejected:  (e) => ({ reason: Schema.String }),
        Started:   (e) => ({ priority: e.input.priority, inFlight: e.root.inFlight }),
        Retried:   (e) => ({ attempts: e.leaf.attemptsSoFar }),
        Completed: (e) => ({ durationMs: e.exit.duration, attempts: e.leaf.attemptsSoFar }),
        Failed:    (e) => ({ durationMs: e.exit.duration, cause: e.exit.cause, reason: Schema.String }),
      },
      RateLimit: { default: EntryEvent },
    },
  },
) {}
```

Bundle = compose's two parts (structure + schema tree) in **one** `Telemetry.Tag` call. Schemas use the §3 tree forms; they are **not** placed on legs. (`Telemetry.default(…)` as a leg-level part is **not** a thing — defaults are the `default:` key in the tree.)

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

✅ Resolved: module split (`State` structure / `Telemetry` observability); inferred wire-tree + `declare`; path-local intersection; op↔scope via `R`; inline `leaf`; descendant nesting; operation ≠ event; operation input as `Schema`; triad + `inner`; sibling group-import into `inner` (`Telemetry.spread` flat / `Telemetry.group` nested); flat handles; multi-branch snapshot + path-local reads; telemetry state on extended scopes (`Metric` = export); event reuse + intersection; interrupt optional; **event schemas** — *events carry only what the schema specifies (no auto-scope)*; **wire-keyed schema tree** with group `default` + sparse/omitted entries, scopes derived from schemas; reusable bases (`Telemetry.Schema(Scope)`, `.Schema` extend, `Base`/`Base.extend`/`ScopeTel.event`, template slots, flat-merge); `Telemetry.Event` per-event classes **dropped**; **compose `Telemetry.Tag(StateTag)(tree)` (Example 1) locked**; **bundle `Telemetry.Tag(domain)(facetId, structure, schemaTree)` (Example 2) locked** — same schema tree, structure inlined, schemas never on legs; `Telemetry.Service` = + layer.

---

## 9. Package reality (verified)
- core `effect@4.0.0-beta.76`: `Metric`, `Tracer`+`withSpan`, `Logger`, `SubscriptionRef`, `PubSub`, `Stream`, `Context`, `Schema`; `Cause` = flat `reasons[]`; `Exit` = `Success | Failure(Cause)`; RPC/http/socket under `effect/unstable/*`.
- installed adjacent: `@effect/platform-node` (+ shared), `@effect/sql-sqlite-node`.
- not installed: `@effect/opentelemetry`, `@effect/experimental`, `@effect/cluster`, `@effect/workflow`.
