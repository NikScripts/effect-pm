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
| **Process state** | Kernel / business logic (`State.Scope`) | Fiber / bracket (`Scope.run`) | In-memory only | Run the effect; ids and tick context the process **needs** |
| **Telemetry state** | Telemetry runtime only (API 3 — emit legs, operation runner) | Worker / compose scope (in-memory) | **Never** `RuntimeStorage` | Hidden scope fields, counters between emits — process **must not** get/set |
| **Projection state** | Live read API (`*Projection`) | In-memory; optional hydrate once from archive | Not written by emit | Dashboard “now” — **derived from events**, not emit-side scratch |
| **Durable operational state** | Archive / ops facets (plan 13) | Durable rows | **`RuntimeStorage`** | Rate limits, leases, config rows — **not** telemetry state |

**Common mistakes:**

- Calling durable `ProcessStore.state` “telemetry state” — **wrong**.
- Putting telemetry counters in kernel `Ref` (`RunResource.ts` today) — **wrong**; delete when API 3 ships.
- Using `TelemetryHub.defineEvent` as the telemetry tree — **wrong**; use **`Telemetry.Tag`** + plan 17 DSL.
- Using **`Telemetry.Service`** in this package — **wrong**; use **`Telemetry.Tag`** + **`Telemetry.layer(tag)`**.

---

## Three telemetry APIs (locked — do not conflate)

| # | API | Public | Role |
| --- | --- | --- | --- |
| **1** | **Definition** | **`Telemetry.Tag`** | Facet tree in `store/*Telemetry.ts` — extend, bindings, logWarning |
| **2** | **Calling** | Static paths on Tag + layer | Builder → `{ input, telemetry, scope }` |
| **3** | **Runtime** | **`Telemetry.layer(tag)`** | Implementation in **`src/internal/telemetry/`** — emit, runner, state Refs |

Store/RPC **`Procedure.payload().success().failure()`** is separate.

---

## Process state (`State.Scope`)

**Module:** `src/State.ts`, `*Scope.ts`.

- Kernel provides via builder `provideLeaf`, `Scope.run`, or `Scope.layer`.
- **`OperationContext.scope`** — live read view.
- **`Scope.patch(partial)`** — process-visible fields only mid-op.

---

## Telemetry state (in-memory, telemetry-exclusive)

**Not shipped.** Bake locked (Jun 2026):

- **`Telemetry.extend(scope, fields)`** on Tag (API 1); Refs in runtime (API 3).
- Same runtime object as process scope; hidden from process types.
- Entry cleanup on operation exit.
- Never `RuntimeStorage`.

---

## Projection state

**Module:** `src/*Projection.ts`, `sink/ProjectionSink.ts`.

- Updated from hub via `ProjectionSink`; separate tag from emit.

**Shipped (pilot):** `RunResourceProjection` only.

---

## Durable operational state (plan 13)

**Plan 17 §12 `ProcessStore.state`** — archive/ops only; not telemetry state.

---

## Telemetry stack (target — bake locked)

```text
Kernel
  └── scopes only
  └── QueueResourceTelemetry.Entry.processEntry(...).provideLeaf(...)   // API 2

store/RunResourceTelemetry.ts — Telemetry.Tag (API 1)
  ├── namespace / group / operation / event
  ├── Telemetry.extend, bindings, .pipe(logWarning)

Telemetry.layer(RunResourceTelemetry)     // API 3 — internal/telemetry/*
Telemetry.registry([RunResourceTelemetry, ...])

TelemetryHub → sinks (Archive, Projection, Broadcast)
```

**Emit `R` (kernel):** none (stub) or `TelemetryHub` only.

**Interim debt:** `defineEvent`, `RunResourceHubTelemetry`, kernel `stateRef` — replace.

---

## Siloing

- Explicit compose layers (`RunResourceCompose.layerPersist`).
- `Telemetry.registry` scoped to tags the app passes in.

---

## Doc map

| Topic | Doc |
| --- | --- |
| Process state / scopes | [18](./18-resource-state-scope.md) |
| Telemetry tree DSL | [17](./17-facet-telemetry-factory.md) §5 |
| Hub + sinks + split | [20](./20-process-store-split-and-telemetry.md) |
| **This vocabulary** | **21 (this file)** |
| **Bake locks (SSoT)** | [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) |
