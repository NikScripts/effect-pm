# Telemetry open decisions — bake

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Goal:** Lock identifier + factory details before implementer continues Step 1+.  
**SSoT after bake:** [telemetry-requirements.md](./telemetry-requirements.md) change log.

**RunResource module service (domain tag + kernel split):** **[run-resource-service-handoff.md](../handoffs/run-resource-service-handoff.md)** — implement **R1–R6** before or in parallel with telemetry Step 1 where scope/tag imports block.

---

## Agreed direction (Jun 8 — owner, updated)

### RunResource domain module (locked — see handoff)

- **`RunResource` = `Context.Service` class** — id `@nikscripts/effect-pm/RunResource`; shape = factory API (`RunResourceApi`).
- **Drop `RunResourceIdentity.ts`** — domain identity is the service class; internal import from `internal/runResource/service.ts`.
- **External tag for filters:** `Tag.RunResource` from `@nikscripts/effect-pm/Tags` only.
- **Tag / kernel split** — kernel imports tag; tag does not import kernel (top-level).
- **`RunResourceScope`** — class extending `State.Scope(RunResource)({ … })` (needs `State.ts` update).
- **Do not** derive wire namespace from domain tag strings.

### Telemetry / facets (unchanged by RunResource service work)

- **Facets are services** — `RunResourceTelemetry`, `RunResourceStore`, … same naming whether built with `.Tag` or `.Service`; **only layer attachment differs**.
- **No `"Tag"` in service id strings or domain product class names** (e.g. not `RunResourceTag` for domain; telemetry tree name **O6** in handoff).
- **`Telemetry.namespace("RunResource")`** — wire-only; domain link is a **separate factory arg**, not inside `namespace`.
- Wire ids from **`Namespace.Group.Event`** — not from domain tag / `.key` / string splits.

---

## Mise en place

| Fact | Implication |
| --- | --- |
| `export const RunResource = { … }` today | Becomes **`class RunResource` + statics**; barrel re-exports from kernel |
| Step 0 shipped `RunResourceIdentity.ts` | **Delete** — superseded by service class |
| `RunResourceStore` id `@nikscripts/effect-pm/store/RunResource/RunResourceStore` | Unchanged |
| Effect v4 | `Context.Service` — domain + facets; see handoff for module layout |

---

## Locked ingredients

*(RunResource domain — see [run-resource-service-handoff.md](../handoffs/run-resource-service-handoff.md) § Locked decisions)*

---

## Open recipe steps

### RunResource module (handoff O1–O5)

See [run-resource-service-handoff.md](../handoffs/run-resource-service-handoff.md) § Open decisions.

### Telemetry-only (after R1–R4 / scope ready)

1. **`Telemetry.Tag` factory signature** — domain ref + facet id + wire tree
2. **Telemetry tree class name** — O6: `RunResourceTelemetry` vs doc `RunResourceTag`
3. **Generated identity statics** — Effect v4 parity (`.key`, `Context.Service.Identifier`) if needed on facet classes
4. *(deferred)* D5 snapshot schema, wiring namespace export, log legs, `state.from` typing

---

## Rejected substitutions

- Hand-maintained `RunResourceIdentity.ts` with manual `TypeTag`/`TypeId` (Step 0 approach — superseded)
- Hollow domain anchor (tag with no implementation shape)
- Class or **domain** path names containing `Tag` (`RunResourceTag` as domain product)
- Passing domain tag into `Telemetry.namespace`
- Deriving wire prefix from domain service id string
- `Telemetry.Tag` product named differently from what `.Service` would produce (facet naming)
