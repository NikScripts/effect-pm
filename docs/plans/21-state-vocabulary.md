# 21 — State vocabulary (process, telemetry, projection, durable ops)

**Status:** locked with [telemetry-requirements.md](../recipes/telemetry-requirements.md) (Jun 2026 API revision).

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
| **1** | **`Telemetry.Tag`** | **`Telemetry.Tag<Self>(domain)(facetId, …tree)`** | Skeleton + **calling paths** — handles, schemas, wire ids |
| **2** | **Calling** | Static paths on **Tag** (mirrored on facet export) | Builder → `{ input, telemetry, scope }` |
| **3** | **Wiring** | **`Wiring.sections(…)` + `satisfies WiringConfig<Tag>`** | `extend`, **`bind.pipe(log…)`** |
| **∴** | **Facet layer** | **`Telemetry.layer(Tag, wiring)`** | Facet runtime **`Layer`** → **`TelemetryRouter`** |
| **∴** | **Facet export** | **`Telemetry.withLayer(Tag, layer)`** | Tag + **`.layer`** |

**Router:** **`TelemetryRouter`** (rename **`TelemetryHub`**) — in-process fan-out to sinks.  
**Transport:** **`telemetryTransport`** — live wire (plan 19), fed by **`BroadcastSink`**.

Store/RPC **`Procedure.payload().success().failure()`** is separate.

---

## File layout (RunResource example)

```text
src/store/RunResourceTelemetry.ts           — Tag class + barrel (withLayer)
src/store/RunResourceTelemetry.wiring.ts    — satisfies WiringConfig<Tag> (API 3)
src/store/RunResourceTelemetry.service.ts   — runResourceTelemetryLayer
src/internal/runResource/service.ts         — RunResource domain Context.Service
src/Tags.ts                                 — Tag.RunResource
src/internal/telemetry/                     — runtime for Telemetry.layer
src/TelemetryRouter.ts                      — emit router (rename TelemetryHub)
```

---

## Telemetry stack (target)

```text
Kernel
  └── RunResourceTelemetry.Entry.processEntry(…).provide({ entryId })   // API 2

Telemetry.Tag                             // API 1 + 2
Wiring.sections(…) satisfies WiringConfig // API 3
Telemetry.layer(Tag, wiring)              // facet runtime Layer
Telemetry.withLayer(Tag, layer)           // export Tag + .layer

Telemetry.registry([…facet exports…])
TelemetryRouter → sinks → telemetryTransport (optional)
```

**Emit `R` (kernel):** none (stub) or **`TelemetryRouter` only**.

**Interim debt:** `defineEvent`, `RunResourceHubTelemetry`, kernel `stateRef`.

---

## Doc map

| Topic | Doc |
| --- | --- |
| **Implementation SSoT** | [telemetry-requirements.md](../recipes/telemetry-requirements.md) |
| **Bake locks (discussion history)** | [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) |
| Hub + sinks | [20](./20-process-store-split-and-telemetry.md) |
| Tree DSL | [17](./17-facet-telemetry-factory.md) §5 |
| Scopes | [18](./18-resource-state-scope.md) |
