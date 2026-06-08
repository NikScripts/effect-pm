# Telemetry implementation — agent handoff

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Audience:** implementation agent (including author of [telemetry-recon-findings.md](../recipes/telemetry-recon-findings.md))  
**Gate (SSoT):** [telemetry-requirements.md](../recipes/telemetry-requirements.md) — **read this first for API shape**  
**Change log:** requirements doc § Implementation change log (**2026-06-08 API revision**)

---

## Read order

| Order | Doc | Use for |
| --- | --- | --- |
| 1 | **[telemetry-requirements.md](../recipes/telemetry-requirements.md)** | Locked API, steps, compose, rejected list, CHK table |
| 2 | **[telemetry-recon-findings.md](../recipes/telemetry-recon-findings.md)** | **Codebase gaps only** — what exists vs missing on branch |
| 3 | [21-state-vocabulary.md](../plans/21-state-vocabulary.md) | Four state words + stack diagram |
| 4 | [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Router vs sinks vs **telemetryTransport** |
| 5 | `origin/cursor/facet-telemetry-158c` | **Schemas + wire layout only** — not factory DSL |

**Do not implement from:** [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) API sections (historical; pre–Jun 8 revision). Calling invariants there may still apply; **shape** comes from requirements.

---

## Recon doc — what's still valid

Your recon remains the best **branch baseline**. Update your mental model for API decisions:

| Recon item | Status for implementer |
| --- | --- |
| **D1** golden `Telemetry.tag` vs `Telemetry.group` | Still valid — deliberate rename |
| **D2** `[RunResourceScope]` as extend key | **Superseded** — use **`Telemetry.extend(scope, fields)`** |
| **D3** handle-keyed `nodes` object | **Resolved** — **`Telemetry.bind(handle, fields).pipe(…)`** + **`satisfies WiringConfig<Tag>`** |
| **D4** golden pipe vs wiring `logWarning` | **Superseded** — **`bind.pipe(Telemetry.logWarning, …)`** on wiring only; **no pipe on Tag** |
| **D5** `RunResourceStateSchema` home | **Still open** — move before deleting `src/store/RunResourceTelemetry.ts` |
| **D6** missing export subpaths | **Still valid** — Step 0 |
| **"Port from golden"** | **Still valid** — schemas/wires port; **factory is net-new** |
| **CHK recommendations in recon §5** | **Mostly locked in requirements CHK table** — implement requirements, not recon recommendations |

---

## Locked API (implement exactly this)

### Files (RunResource pilot)

```text
store/RunResourceTag.ts                   — Telemetry.Tag (API 1 + 2)
store/RunResourceTelemetry.wiring.ts        — Wiring.sections(…) satisfies WiringConfig<Tag>
store/RunResourceTelemetry.service.ts       — Telemetry.layer(Tag, wiring)
store/RunResourceTelemetry.ts               — Telemetry.withLayer(Tag, layer) + export Tag
src/Telemetry.ts                            — factories (Tag, Wiring, layer, withLayer, registry)
src/TelemetryRouter.ts                      — rename from TelemetryHub (see below)
src/internal/telemetry/                     — materialize, runner, telemetry state
```

### Canonical authoring

```ts
// API 1 + 2 — Tag owns id + tree + calling paths
export class RunResourceTag extends Telemetry.Tag<RunResourceTag>()(
  "@nikscripts/effect-pm/store/RunResource/RunResourceTag",
  Telemetry.namespace("RunResource"),
  /* group / operation / event / start / exit — NO bind, NO pipe on events */
) {}

// API 3 — define wiring + real type validation
export const runResourceWiring = Wiring.sections(
  Telemetry.extend(RunResourceScope, {
    waiting: Telemetry.metric.gauge,
    /* … */
  }),
  Telemetry.bind(RunResourceTag.Run.run.Started, {
    payload: { concurrency: Telemetry.state.from((s) => s.gateConcurrency) },
  }).pipe(
    Telemetry.logWarning("RunResourceStore write failed for run start", ({ runId }) => ({
      runId: String(runId),
    })),
  ),
  /* every RequiredBindMap entry … */
) satisfies WiringConfig<typeof RunResourceTag>

// Facet runtime Layer — regular Layer typing at provide time
export const runResourceLayer = Telemetry.layer(RunResourceTag, runResourceWiring)

// Facet export — same paths as Tag + .layer
export const RunResourceTelemetry = Telemetry.withLayer(RunResourceTag, runResourceLayer)
```

### Bind / exhaustiveness rules

- **`PlainFields`** → required keys in **`Telemetry.bind(handle, { … })`**.
- **Define site:** `satisfies WiringConfig<Tag>` (missing keys = normal TS property errors).
- **Layer build:** `Telemetry.layer(tag, wiring)` accepts **`wiring: WiringConfig<Tag>`** only.
- **Per bind:** second arg is **plain field map** (schema-shaped), not `{ bind: … }`.
- **No fake types** like `{ ERROR: "Missing…" }`.
- **`*.test-d.ts`:** `@ts-expect-error` for missing bind, extra keys, wrong leg context.
- **Optional schema fields** → optional bind keys (CHK-12).
- **Literal fields needing runtime source** (e.g. `reason`) → PlainFields + **`Telemetry.state.from`** (CHK-18).

### Router vs transport (do not conflate)

| Module | Role |
| --- | --- |
| **`TelemetryRouter`** | In-process **`emit`** + sink fan-out (rename **`TelemetryHub`**) |
| **`Telemetry.layer`** | Facet runtime → calls **`TelemetryRouter.emit`** |
| **`telemetryTransport`** | **Wire** `/ws/telemetry` — plan 19; fed by **`BroadcastSink`**, not router API |

Compose:

```ts
Layer.provideMerge(
  TelemetryRouter.layer,
  RunResourceTelemetry.layer,
  ArchiveSink.layerForStore(RunResourceStore, …),
  BroadcastSink.layer,              // optional → telemetryTransport
  telemetryTransport.serverLayer,   // optional
)
```

**Emit `R` at kernel:** stub or **`TelemetryRouter` only** — never `RuntimeStorage`.

---

## Codebase today (recon summary)

| Exists on branch | Missing / debt |
| --- | --- |
| `TelemetryHub.ts`, sinks, `telemetryTransport` | `src/Telemetry.ts`, `internal/telemetry/` |
| `defineEvent` in `RunResourceTelemetry.ts` | `RunResourceTag`, `WiringConfig` factory |
| `stateRef` in `RunResource.ts` | `RunResourceIdentity.ts`, telemetry export subpaths |
| `RunResourceScope.ts`, `State.Scope` | **`TelemetryRouter` rename** (still `TelemetryHub` in code) |
| Golden branch schemas on `facet-telemetry-158c` | Facet `Telemetry.layer` + kernel migration |

---

## Do NOT implement

- `Telemetry.Service(Tag, { extend, nodes })` or handle-keyed wiring objects
- `Telemetry.event(…).pipe(…)` on **Tag**
- `{ ERROR: … }` branded exhaustiveness return types
- New code using **`TelemetryHub`** name — use **`TelemetryRouter`**
- `defineEvent` / kernel `stateRef` in final RunResource path (delete in Step 8)
- ProcessStore telemetry section for new facets

Full list: requirements § [Rejected](#12-rejected-do-not-build).

---

## Implementation order

Follow requirements **§ 5 Steps 0–10**. Suggested focus:

1. **Step 0** — exports, `RunResourceIdentity`, plan 21 pointer
2. **TelemetryRouter rename** — can land with Step 0 or Step 1 (update sinks + transport imports)
3. **Step 1–2** — `Telemetry.Tag` + `RunResourceTag` (golden schemas, new tree DSL)
4. **Step 3** — `Wiring.sections`, `WiringConfig`, `Telemetry.bind.pipe`, **`*.test-d.ts`**
5. **Step 4–6** — calling API, `internal/telemetry`, `Telemetry.layer` + runner + router bridge
6. **Step 7–8** — registry, RunResource kernel migration, delete debt
7. **Queue** — separate slice; `RateLimit.Exceeded` bind table (CHK-13 deferred there)

**Resolve before deleting debt file:** **D5** — new home for **`RunResourceStateSchema`**.

---

## Owner decisions still needed at implementation time

Document in requirements **change log** if you lock these while coding:

| Topic | Guidance |
| --- | --- |
| **`Telemetry.state.from` typing** | Hidden state view from `extend` + metrics-leg pending fields — design in factory; no string paths |
| **Log legs in v1** | `logWarning` required where archive can fail; `logInfo` / `logError` / `annotateLogs` in pipe API — confirm which ship in v1 |
| **`Wiring` namespace** | `Wiring.sections` vs `Telemetry.Wiring.sections` — pick one export, document in requirements if not already implied |

CHK **deferred** (do not block RunResource pilot): 05, 06, 07, 08, 09, 13 (Queue).

---

## Verification (every step)

```text
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```

Add **`*.test-d.ts`** for `WiringConfig` / `BindFields` when wiring factory lands.

---

## If the spec is wrong

Per requirements header: append to **§ Undocumented / verify** and **change log** in the same PR — do not silently diverge.
