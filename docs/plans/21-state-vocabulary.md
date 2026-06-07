# 21 — State vocabulary (process, telemetry, projection, durable ops)

**Status:** locked with [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) (Jun 2026).

**Related:** [18-resource-state-scope.md](./18-resource-state-scope.md),
[17-facet-telemetry-factory.md](./17-facet-telemetry-factory.md),
[20-process-store-split-and-telemetry.md](./20-process-store-split-and-telemetry.md),
[STORAGE.md](../STORAGE.md).

---

## Rule: four different “state” words — do not conflate

| Term | Who reads/writes | Lifetime | Storage | Purpose |
| --- | --- | --- | --- | --- |
| **Process state** | Kernel / business logic (`State.Scope`) | Fiber / bracket | In-memory only | Run the effect |
| **Telemetry state** | Telemetry runtime (`internal/telemetry`) | Worker / compose scope | **Never** `RuntimeStorage` | Hidden scope fields, counters between emits |
| **Projection state** | Live read API (`*Projection`) | In-memory; optional hydrate | Not written by emit | Dashboard “now” |
| **Durable operational state** | Archive / ops facets (plan 13) | Durable rows | **`RuntimeStorage`** | Rate limits, leases — **not** telemetry state |

**Common mistakes:** kernel `Ref` counters; `defineEvent` as tree; durable `ProcessStore.state` as telemetry state.

---

## Three telemetry APIs (locked)

| # | API | Surface | Role |
| --- | --- | --- | --- |
| **1** | **`Telemetry.Tag`** | Class + tree DSL | **Skeleton** — wires, schemas, ops, events, **node handles** |
| **2** | **Calling** | Static paths on **Service** | Builder → `{ input, telemetry, scope }` |
| **3** | **Wiring** | **`Telemetry.Wiring<Tag>`** | `{ extend, nodes }` — 2nd arg to **`Telemetry.Service`** |
| **∴** | **`Telemetry.Service`** | `Telemetry.Service(Tag, wiring)` | Facet export; **`.layer`** = Effect Layer |

**Internal** spine/kernel does not import Service for wiring — uses Service static paths when **`Service.layer`** is provided.

Store/RPC **`Procedure.payload().success().failure()`** is separate.

---

## File layout (RunResource example)

```text
store/RunResourceTag.ts          — Telemetry.Tag (API 1) — optional split
store/RunResourceTelemetry.ts    — Telemetry.Service(Tag, wiring) + re-export
src/RunResourceIdentity.ts       — TypeTag / TypeId
src/internal/telemetry/          — runtime impl for Service.layer
```

---

## Telemetry stack (target)

```text
Kernel
  └── QueueResourceTelemetry.Entry.processEntry(...).provideLeaf(...)   // API 2

Telemetry.Tag                    // API 1 — skeleton
Telemetry.Service(Tag, wiring)  // API 3 wiring + compose
  └── .layer                     // Effect Layer → internal/telemetry/*

Telemetry.registry([...Service tags])
TelemetryHub → sinks
```

**Emit `R` (kernel):** none (stub) or `TelemetryHub` only.

**Interim debt:** `defineEvent`, `RunResourceHubTelemetry`, kernel `stateRef`.

---

## Doc map

| Topic | Doc |
| --- | --- |
| **Bake locks (SSoT)** | [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) |
| Hub + sinks | [20](./20-process-store-split-and-telemetry.md) |
| Tree DSL | [17](./17-facet-telemetry-factory.md) §5 |
| Scopes | [18](./18-resource-state-scope.md) |
