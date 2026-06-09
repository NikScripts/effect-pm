# Telemetry open decisions — bake

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Goal:** Lock identifier + factory details before implementer continues Step 1+.  
**SSoT after bake:** [telemetry-requirements.md](./telemetry-requirements.md) change log.

**RunResource domain module:** **[run-resource-service-handoff.md](../handoffs/run-resource-service-handoff.md)** — R1–R6.

---

## Locked (Jun 8 — owner)

### `Telemetry.Schema.Struct` (wire projection)

| Rule | Lock |
| --- | --- |
| **`.Struct`** | Static on every `Telemetry.Schema` class — factory-built |
| **`.Type`** | Full decoded wire payload (same as `Struct.Type`) — **not** plain-only |
| **Field mapping** | Every author field → regular `Schema.*` (scope → underlying schema, terminals → `Number`, …) |
| **Nested schemas** | Recursive via nested `Telemetry.Schema` class; cycles throw at factory time |
| **`PlainFields`** | `@internal` only — wiring exhaustiveness (Step 3), not public API |

```ts
class RunResourceRunStarted extends Telemetry.Schema<RunResourceRunStarted>()(RunScope)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ concurrency: Schema.Number }),
}) {}

RunResourceRunStarted.Struct   // Store RPC / decode
typeof RunResourceRunStarted.Type
```

### `Telemetry.Tag` signature

```ts
Telemetry.Tag<Self>(domain)(facetId, Telemetry.namespace("…"), …tree)
```

| Slot | Lock |
| --- | --- |
| **1st call** | Domain module **`Context.Service`** (e.g. **`RunResource`**) |
| **2nd call, 1st arg** | Facet service id string (e.g. `@nikscripts/effect-pm/store/RunResource/RunResourceTelemetry`) |
| **2nd call, 2nd arg** | **`Telemetry.namespace("RunResource")`** — wire prefix only |
| **Wires** | **`Namespace.Group.Event`** from namespace — **not** from domain tag / `split` / `TypeTag` |

### Facet product name

- **`RunResourceTelemetry`** — Tag class + kernel calling export (not `RunResourceTag`).

### Domain module

- **`RunResource`** = `Context.Service` with factory API — see run-resource handoff.
- **`Tag.RunResource`** from `@nikscripts/effect-pm/Tags` for filter inputs.
- **Delete** `RunResourceIdentity.ts`.

### Scopes

- **`class RunResourceScope extends State.Scope(RunResource)({ … })`** — requires `State.ts` update (handoff O1).

### Telemetry / facets (unchanged)

- **`Telemetry.namespace`** — wire-only; **not** domain ref inside namespace.
- Facets: **`RunResourceTelemetry`**, **`RunResourceStore`**, … — layer attachment differs, not product naming.

---

## Open (telemetry-only)

| ID | Topic | Status |
| --- | --- | --- |
| **D5** | **`RunResourceState` snapshot** — plain struct vs `Telemetry.Schema` class vs extend-derived | **Active bake step** |
| *(deferred)* | Wiring namespace export, log legs surface, `state.from` typing | After D5 + Step 3 |

---

## Rejected

- Hand-maintained **`RunResourceIdentity.ts`**
- **`RunResourceTag`** as facet / domain product name
- **`Telemetry.Tag<Self>()(facetId, …)`** without **domain** in 1st call
- **`Telemetry.Tag<…>(id)(`** / **`(id)(`** wrong arity
- Deriving wire prefix from domain tag string
- Passing domain into **`Telemetry.namespace`**
- Hollow domain anchor service
