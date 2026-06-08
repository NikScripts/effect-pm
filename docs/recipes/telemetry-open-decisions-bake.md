# Telemetry open decisions — bake

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Goal:** Lock identifier + factory details before implementer continues Step 1+.  
**SSoT after bake:** [telemetry-requirements.md](./telemetry-requirements.md) change log.

**RunResource domain module:** **[run-resource-service-handoff.md](../handoffs/run-resource-service-handoff.md)** — R1–R6.

---

## Locked (Jun 8 — owner)

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

| ID | Topic |
| --- | --- |
| **D5** | `RunResourceStateSchema` home before deleting debt telemetry file |
| *(deferred)* | Wiring namespace export, log legs surface, `state.from` typing |

---

## Rejected

- Hand-maintained **`RunResourceIdentity.ts`**
- **`RunResourceTag`** as facet / domain product name
- **`Telemetry.Tag<Self>()(facetId, …)`** without **domain** in 1st call
- **`Telemetry.Tag<…>(id)(`** / **`(id)(`** wrong arity
- Deriving wire prefix from domain tag string
- Passing domain into **`Telemetry.namespace`**
- Hollow domain anchor service
