# 21 — State vocabulary (process, telemetry, projection, durable ops)

**Status:** owner-aligned vocabulary (Jun 2026). **Bake before implementation** —
see [telemetry-split-bake.md](../recipes/telemetry-split-bake.md).

**Related:** [18-resource-state-scope.md](./18-resource-state-scope.md),
[17-facet-telemetry-factory.md](./17-facet-telemetry-factory.md),
[20-process-store-split-and-telemetry.md](./20-process-store-split-and-telemetry.md),
[STORAGE.md](../STORAGE.md).

---

## Rule: four different “state” words — do not conflate

| Term | Who reads/writes | Lifetime | Storage | Purpose |
| --- | --- | --- | --- | --- |
| **Process state** | Kernel / business logic (`State.Scope`) | Fiber / bracket (`Scope.run`) | In-memory only | Run the effect; ids and tick context the process **needs** |
| **Telemetry state** | Telemetry path **only** (emit legs, metrics, logs) | Worker / compose scope (in-memory) | **Never** `RuntimeStorage` | Metrics, rolling calcs, counters between emits — process **must not** get/set |
| **Projection state** | Live read API (`*Projection`) | In-memory; optional hydrate once from archive | Not written by emit | Dashboard “now” — **derived from events**, not emit-side scratch |
| **Durable operational state** | Archive / ops facets (plan 13) | Durable rows | **`RuntimeStorage`** | Rate limits, leases, config rows — **not** telemetry state |

**Common mistakes (including prior agent work):**

- Calling durable `ProcessStore.state` “telemetry state” — **wrong** (plan 17 §12 is **ops storage**, not metrics scratch).
- Putting telemetry counters in kernel `Ref` (`RunResource.ts` today) — **wrong boundary**; belongs in telemetry state or emit legs.
- Using `TelemetryHub.defineEvent` as the telemetry tree — **wrong**; tree is `Telemetry.Service` + plan 17 DSL.
- Using projection for metrics scratch — **wrong**; projection is read-model for UI.

---

## Process state (`State.Scope`)

**Module:** `src/State.ts`, `*Scope.ts` (`ProcessScope`, `RunScope`, …).

- Declared with `State.Scope(...)` / `withLeaf`.
- Kernel provides via `Scope.run(state, effect)` or `Scope.layer`.
- Telemetry **may read** scope fields when materializing event payloads (`Telemetry.Schema(scope)(fields)`).
- Process **does not** use telemetry state for business logic.

**Shipped:** factory + scopes + `ProcessScope.run` in `Process.ts`.  
**Gap:** `RunResource.ts` still uses ad-hoc `Ref` instead of `RunScope` for run identity.

---

## Telemetry state (in-memory, telemetry-exclusive)

**Not shipped.** No public API yet.

**Intent (owner, Jun 2026):**

- Hold values needed **only** for observability: emit counts, rolling averages, time-since-last-event, histogram buckets, log annotations.
- Updated in the **emit pipeline** (e.g. plan 17 phase-2 `prepare` / `metrics` legs) — not by kernel code.
- Survives **between emits** on the same worker instance (in-memory).
- Output goes to **logs and telemetry** (event payloads, annotations, future metric sinks).
- **Never** persisted to archive; omit `ArchiveSink` does not lose telemetry state (only fact rows).

**Not:**

- `State.Scope` (that is process state).
- `RunResourceProjection` (read model).
- `ProcessStore.state` / rate-limit rows (durable ops).

**Likely home (bake to confirm):** colocated with `Telemetry.Service` compose — e.g. `RunResourceTelemetry.layer` provides in-memory telemetry state; only emit/metrics/log legs require it.

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

## Telemetry stack (target — not current hub interim)

```text
Kernel
  └── ProcessScope / RunScope only
  └── yield* RunResourceTelemetry.Run.Started(...)   // static on Telemetry.Service

Telemetry.Service (RunResourceTelemetry)
  ├── tree DSL (Telemetry.namespace / tag / event / logWarning)
  ├── TelemetryState (in-memory) ← bake API
  └── registers wires → Telemetry.registry

TelemetryHub (router)
  └── fan-out to optional sinks (by wire id)

Sinks (opt-in layers)
  ├── ArchiveSink → *Store + RuntimeStorage
  ├── ProjectionSink → *Projection
  ├── BroadcastSink → telemetryTransport
  └── MetricsSink / log legs → future
```

**Emit `R`:** `TelemetryHub` only at kernel sites.  
**Interim debt on hub branch:** `defineEvent` + `RunResourceHubTelemetry` — **replace**, do not extend.

---

## Siloing (requirement)

- Separate subpaths, tags, and layers per concern.
- Combined compose layers **explicitly named** (e.g. `RunResourceCompose.layerPersist`) — not implicit “everything” merges.
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
| Bake / lock before code | [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) |
| Archive authoring | [STORAGE.md](../STORAGE.md) |
| File layout | [src-reorganization.md](./src-reorganization.md) |
