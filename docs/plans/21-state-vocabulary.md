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
| **Telemetry state** | Telemetry path **only** (emit legs, metrics, operation runner) | Worker / compose scope (in-memory) | **Never** `RuntimeStorage` | Hidden scope fields, counters between emits — process **must not** get/set |
| **Projection state** | Live read API (`*Projection`) | In-memory; optional hydrate once from archive | Not written by emit | Dashboard “now” — **derived from events**, not emit-side scratch |
| **Durable operational state** | Archive / ops facets (plan 13) | Durable rows | **`RuntimeStorage`** | Rate limits, leases, config rows — **not** telemetry state |

**Common mistakes (including prior agent work):**

- Calling durable `ProcessStore.state` “telemetry state” — **wrong** (plan 17 §12 is **ops storage**, not metrics scratch).
- Putting telemetry counters in kernel `Ref` (`RunResource.ts` today) — **wrong boundary**; belongs in telemetry state (delete `stateRef` when layer ships).
- Using `TelemetryHub.defineEvent` as the telemetry tree — **wrong**; tree is `Telemetry.Service` + plan 17 DSL.
- Using projection for metrics scratch — **wrong**; projection is read-model for UI.

---

## Process state (`State.Scope`)

**Module:** `src/State.ts`, `*Scope.ts` (`ProcessScope`, `RunScope`, …).

- Declared with `State.Scope(...)` / `withLeaf`.
- Kernel provides via `Scope.run(state, effect)`, builder `provideLeaf`, or `Scope.layer`.
- **`OperationContext.scope`** is a live read view of the same Context.
- **`Scope.patch(partial)`** updates process-visible fields mid-op (hidden telemetry fields excluded from patch type).
- Telemetry **reads** scope when materializing event payloads (`Telemetry.Schema` scope-bound fields).

**Shipped:** factory + scopes + `ProcessScope.run` in `Process.ts`.  
**Gap:** `RunResource.ts` still uses ad-hoc `Ref` instead of telemetry state for counters.

---

## Telemetry state (in-memory, telemetry-exclusive)

**Not shipped.** Bake locked API (Jun 2026):

- **Same runtime object** as process scope; **`Telemetry.extend(scope, fields)`** on Service tree adds hidden fields.
- Metric kinds v1: `gauge`, `counter`, `timestamp`, `duration(from, to)`.
- Updated in **emit pipeline metrics leg** + **operation runner** — kernel never `yield* TelemetryState`.
- **Entry cleanup:** drop entry-scoped hidden fields when operation **exit** completes.
- Reducers v1: simple counter bumps on configured exit wires.
- Snapshot / introspection: **`@internal` v1**.
- **Never** persisted to archive.

**Home:** `RunResourceTelemetry.layer` (and domain equivalents) — colocated with Service compose.

---

## Projection state

**Module:** `src/*Projection.ts`, `sink/ProjectionSink.ts`.

- Updated from hub events via `ProjectionSink` (optional layer).
- Live queries (`latestState`, `depth`, …) — separate `Context.Tag` from emit.
- May **hydrate once** from archive at layer init; no polling on hot path.

**Shipped (pilot):** `RunResourceProjection` only.

---

## Durable operational state (plan 13 — not telemetry state)

**Plan 17 §12 `ProcessStore.state` (`offset.get/set`)** — separate **archive/ops** section:

- Rate-limit counters, leases, mutable config rows — **durable** via `RuntimeStorage`.
- Distinct from telemetry state (which never touches storage).
- Tracked as gap in [14-conversation-capture-may-2026.md](./14-conversation-capture-may-2026.md).

---

## Telemetry stack (target — bake locked)

```text
Kernel
  └── ProcessScope / RunScope only
  └── yield* RunResourceTelemetry.Run.process(...).provideLeaf(...)   // no hub in R without layer

Telemetry.Service (RunResourceTelemetry)
  ├── Tag-shaped tree + extend + bindings + .pipe(logWarning)
  ├── telemetry hidden fields on scope (extend)
  └── .layer → emit bridge + operation handles

Telemetry.registry([...Services])     // explicit compose Layer

TelemetryHub (router)
  └── fan-out to optional sinks (by wire id)

Sinks (opt-in layers)
  ├── ArchiveSink → *Store + RuntimeStorage
  ├── ProjectionSink → *Projection
  ├── BroadcastSink → telemetryTransport
  └── MetricsSink / log legs → v2
```

**Emit pipeline (locked order):** materialize → metrics leg → validate → hub → sinks.

**Emit `R` (kernel):** none (no-op stub) or `TelemetryHub` only — never `RuntimeStorage`.

**Interim debt on hub branch:** `defineEvent` + `RunResourceHubTelemetry` + kernel `stateRef` — **replace**, do not extend.

---

## Three telemetry APIs (do not conflate)

| API | Role |
| --- | --- |
| **`Telemetry.Tag`** | Skeleton tree — wire catalog; no bindings, no layer |
| **`Telemetry.Service`** | Tag tree + extend + bindings + logWarning pipe + `.layer` |
| **Calling API** | Builder → `Effect` → `{ input, telemetry, scope }` |

Store/RPC **`Procedure.payload().success().failure()`** is separate.

---

## Siloing (requirement)

- Separate subpaths, tags, and layers per concern.
- Combined compose layers **explicitly named** (e.g. `RunResourceCompose.layerPersist`).
- `Telemetry.registry` + archive registry scoped to what the app passes in.

See [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) step 1–2.

---

## Doc map (canonical)

| Topic | Doc |
| --- | --- |
| Process state / scopes | [18](./18-resource-state-scope.md) |
| Telemetry tree DSL | [17](./17-facet-telemetry-factory.md) §5 |
| Hub + sinks + split | [20](./20-process-store-split-and-telemetry.md) |
| **This vocabulary** | **21 (this file)** |
| **Bake locks (SSoT)** | [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) |
| Archive authoring | [STORAGE.md](../STORAGE.md) |
| File layout | [src-reorganization.md](./src-reorganization.md) |
