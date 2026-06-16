# Telemetry API DX bake

Designing how authors define and call facet telemetry. **Split bake not approved.**

Locked shapes: [telemetry-requirements.md](../recipes/telemetry-requirements.md). Examples below are **generic** (any domain/facet).

**Bake order:** Tag → State → Wiring tree API. Event-schema design inside State is **large and deferred** — not Tag work.

---

## Model

| Piece | Locked today | Owner wants (not approved) |
| --- | --- | --- |
| **Combined tree** | `Telemetry.Tag` — tree + schemas + handles | **`TagWithState`** shortcut after split |
| **Skeleton tree** | *(schemas on Tag today)* | **`Tag`** — tree + handles only; streamlined DSL |
| **Schemas + extend** | On Tag (`start("Started", Schema)`) | **`Telemetry.State`** module (not **`Telemetry.Events`**) |
| **Wiring** | `Wiring.sections` + `bind(handle, …)` | Rename / move under **`Telemetry`**; **sections = shortcut** for few binds; **tree API** for many — design **after Tag + State** |
| **Layer** | `Telemetry.layer(Tag, wiring)` + `withLayer` | **`Service`** = Tag + State + Wiring; last |
| **`Telemetry.Wire`** | type helper | unchanged |

---

## Locked tree rules

- `Telemetry.Tag<Self>(domain)(facetId, Telemetry.namespace(...), …groups)`
- Wire: **`Namespace.Group.Event`** — op name **not** in wire
- Groups don't nest; events under group or inside op
- Input on **`Telemetry.operation<Input>`**, not **`Telemetry.start`**
- Not on Tag: extend, bind, log pipe, layer

---

## Approved today — TagWithState (combined tree + schemas)

Shape locked in requirements; **schema field bodies are not final** (see next section).

```ts
export class FacetTelemetry extends Telemetry.Tag<FacetTelemetry>(Domain)(
  "@scope/facet/FacetTelemetry",
  Telemetry.namespace("Facet"),
  Telemetry.group("Group")(
    Telemetry.operation("op")(
      OpScope,
      Telemetry.start("Started", StartedSchema),
      Telemetry.exit({
        onSuccess: Telemetry.event("Completed", CompletedSchema),
        onFailure: Telemetry.event("Failed", FailedSchema),
      }),
    ),
  ),
  Telemetry.group("State")(
    Telemetry.event("Changed", ChangedSchema),
  ),
) {}
```

### Handles (locked)

```ts
FacetTelemetry.Group.op.Started
FacetTelemetry.Group.op.exit.onSuccess   // Completed wire
FacetTelemetry.Group.op.exit.onFailure   // Failed wire
FacetTelemetry.State.Changed
```

### Stress tree patterns (locked — generic)

```ts
// start-only op
Telemetry.operation<Input>("enqueue")(EntryScope, Telemetry.start("Enqueued", EnqueuedSchema));

// exit-only op
Telemetry.operation("release")(LeafScope, Telemetry.exit({
  onSuccess: Telemetry.event("Released", ReleasedSchema),
}));

// start + middle + nested op + exit
Telemetry.operation<Input>("process")(
  EntryScope,
  Telemetry.start("Started", StartedSchema),
  Telemetry.event("Retried", RetriedSchema),
  Telemetry.operation("rateLimit")({
    onFailure: Telemetry.event("Exceeded", ExceededSchema),
  }),
  Telemetry.exit({
    onSuccess: Telemetry.event("Completed", CompletedSchema),
    onFailure: Telemetry.event("Failed", FailedSchema),
    onInterrupt: Telemetry.event("Released", ReleasedSchema),
  }),
);
```

---

## Event schemas — needs redesign (State module; not Tag priority)

**Do not treat shipped/requirements schema examples as approved DX.** Owner notes:

### Scope field access (broken today)

Requirements/shipped use **`Scope.Schema.State…` selector-style** fields (e.g. `runId: OpScope.Schema.State.Run.runId`). **Wrong direction** — should be **helper function(s)**, not nested selector paths.

Open design:

- Must support **telemetry scope** (author + extend), not just process scope
- Must allow reading from **all three** contexts:
  - **root**
  - **`State.Root`** (envelope)
  - **specified leaf** (op scope)
- Which context a field uses must be explicit at authoring time

### Class vs inline schema

- Keep **`Telemetry.Schema` classes** vs define schemas **inside the State tree** inheriting scope from a parent node — **undecided**
- **Reuse:** same schema across events, or an **entire group** — must stay possible; you can't know reuse upfront; standalone classes may still be needed
- Classes mainly useful when multiple events share one schema; helper access either way

**Agent:** don't lock schema syntax until State bake. **Tag bake ignores this.**

---

## Approved — calling (locked)

| Kind | Call |
| --- | --- |
| Operation | `yield* Tag.Group.op(input?).provide({ … })` |
| Op with body | `.provide({ … }).pipe(Effect.flatMap(ctx => …))` |
| Middle event | `yield* ctx.telemetry.EventName` |
| Nested op | `yield* work.pipe(ctx.telemetry.nestedOp)` |
| Root event | `yield* Tag.Group.Event` when root ambient (**not** auto `State.Changed`) |

```ts
yield* FacetTelemetry.Group.op
  .provide({ leafId })
  .pipe(Effect.flatMap((ctx) => body));
```

Events are **`Effect` values** — no `()`. **`.provide` on operations only.**

---

## Approved today — Wiring + layer (locked; generic)

```ts
export const facetWiring = Wiring.sections(
  Telemetry.extend(RootScope, {
    metricA: Telemetry.metric.gauge,
    metricB: Telemetry.metric.counter,
  }),

  Telemetry.bind(FacetTelemetry.Group.op.Started, {
    payload: { field: Telemetry.state.from((s) => s.someField) },
  }).pipe(Telemetry.logWarning("persist failed", (fields) => ({ …fields }))),

  Telemetry.bind(FacetTelemetry.Group.op.exit.onFailure, {
    payload: { durationMs: Exit.durationMs, cause: Exit.cause },
  }).pipe(Telemetry.logWarning("persist failed", (fields) => ({ …fields }))),

  Telemetry.bind(FacetTelemetry.State.Changed, {}).pipe(
    Telemetry.logWarning("persist failed", (fields) => ({ …fields })),
  ),
) satisfies WiringConfig<typeof FacetTelemetry>;

export const facetLayer = Telemetry.layer(FacetTelemetry, facetWiring);
// barrel: Telemetry.withLayer(FacetTelemetry, facetLayer)
```

- **`Telemetry.bind(handle, fields)`** + **`.pipe(logWarning, …)`**
- **`Telemetry.event(…).pipe(…)` on Tag** — rejected
- **`Telemetry.Service(Tag, wiringObject)`** — rejected

---

## Owner direction (not approved)

**Tag (first priority)**

- Schemas off bare Tag; **TagWithState** = today's combined pass
- Streamline tree authoring (how TBD)
- `start` / `event` without schema arg on bare Tag
- `events(...)` shorthand for middle events
- **`Telemetry.Wire`** unchanged

**State (after Tag; schema internals deferred)**

- Module name: **`Telemetry.State`** preferred; **`Telemetry.Events`** rejected
- Tree; keys **group → event name**
- Extend here, not on Tag
- Schema scope helpers + class vs inline + reuse — **separate bake inside State**

**Wiring (after Tag + State)**

- **`Wiring.sections`** renamed; possibly lives under **`Telemetry`**
- **Sections API** = shortcut when few bindings
- **Tree-shaped API** when many bindings — shape TBD after Tag + State
- Bind keys: **group → event name** (not handle paths)

**Service (last)**

- Tag + State + Wiring; server facet
- Client/RPC: Tag + State only

---

## Open

1. Streamlined Tag surface  
2. State module name (`State` vs clash with package `State`)  
3. Event-name collisions across groups  
4. TagWithState vs overloaded Tag  
5. `events()` — rest vs array  
6. Schema scope helpers (root / Root / leaf)  
7. Schema class vs inline in tree; reuse across events/groups  
8. Wiring tree API shape  
9. `Telemetry.layer` arity after split  

---

## Rejected

- **`Telemetry.Events`** module name  
- Schemas only on Wiring  
- **`Scope.Schema.State…` selector paths** as final schema DX (placeholder only today)  
- Agent-invented split APIs until owner approves a bake turn  
