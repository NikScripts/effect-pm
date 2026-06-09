# Telemetry implementation — agent handoff

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Audience:** implementation agent (including author of [telemetry-recon-findings.md](../recipes/telemetry-recon-findings.md))  
**Gate (SSoT):** [telemetry-requirements.md](../recipes/telemetry-requirements.md) — **read this first for API shape**  
**Primary resume (Jun 2026):** [state-root-telemetry-resume-handoff.md](./state-root-telemetry-resume-handoff.md) — **start here** — State.Root, EventNode, emit model, working-tree diff, full issue register  
**Prerequisite:** [run-resource-service-handoff.md](./run-resource-service-handoff.md) **R1–R4** (domain `RunResource` tag before facet Tag / scopes)  
**Change log:** requirements doc § Implementation change log (**2026-06-08 API revision** + Tag signature)

---

## Read order

| Order | Doc | Use for |
| --- | --- | --- |
| 1 | **[telemetry-requirements.md](../recipes/telemetry-requirements.md)** | Locked API, steps, compose, rejected list, CHK table |
| 2 | **[run-resource-service-handoff.md](./run-resource-service-handoff.md)** | Domain `RunResource` service + `Tags.ts` |
| 3 | **[telemetry-recon-findings.md](../recipes/telemetry-recon-findings.md)** | **Codebase gaps only** — what exists vs missing on branch |
| 4 | [21-state-vocabulary.md](../plans/21-state-vocabulary.md) | Four state words + stack diagram |
| 5 | [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Router vs sinks vs **telemetryTransport** |
| 6 | `origin/cursor/facet-telemetry-158c` | **Schemas + wire layout only** — not factory DSL |

**Do not implement from:** [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) API sections when they contradict requirements (historical pre–Jun 8 / pre–Tag-signature).

---

## Recon doc — what's still valid

| Recon item | Status for implementer |
| --- | --- |
| **D1** golden `Telemetry.tag` vs `Telemetry.group` | Still valid — deliberate rename |
| **D2** `[RunResourceScope]` as extend key | **Superseded** — use **`Telemetry.extend(scope, fields)`** |
| **D3** handle-keyed `nodes` object | **Resolved** — **`Telemetry.bind(handle, fields).pipe(…)`** + **`satisfies WiringConfig<Tag>`** |
| **D4** golden pipe vs wiring `logWarning` | **Superseded** — **`bind.pipe(Telemetry.logWarning, …)`** on wiring only; **no pipe on Tag** |
| **D5** `RunResourceStateSchema` home | **Reopened by owner** — interim **`src/store/RunResourceState.ts`** ok; target: nested `Telemetry.Schema` + `.Struct` |
| **D6** missing export subpaths | **Still valid** |
| **"Port from golden"** | **Still valid** — schemas/wires port; **factory is net-new** |

---

## Locked API (implement exactly this)

### `Telemetry.Tag` signature (locked)

```ts
Telemetry.Tag<Self>(domain)(facetId, Telemetry.namespace("…"), …tree)
```

| Part | Where | Example |
| --- | --- | --- |
| **domain** | 1st call — domain module `Context.Service` | `RunResource` |
| **facetId** | 1st arg of 2nd call — facet service id string | `"@nikscripts/effect-pm/store/RunResource/RunResourceTelemetry"` |
| **wire prefix** | 2nd arg of 2nd call | `Telemetry.namespace("RunResource")` → `RunResource.Group.Event` |
| **tree** | rest of 2nd call | `Telemetry.group` / `operation` / `start` / `exit` / `event` |

**Do not:** derive wire namespace from domain tag strings, `TypeTag`, or `domain.key.split`.

### Files (RunResource pilot)

```text
src/Telemetry.ts                            — factories
src/store/RunResourceTelemetry.ts           — Tag class (API 1+2)
src/store/RunResourceTelemetry.wiring.ts    — Wiring.sections satisfies WiringConfig<Tag>
src/store/RunResourceTelemetry.service.ts   — runResourceTelemetryLayer
src/store/RunResourceTelemetry.ts           — barrel: Telemetry.withLayer
src/Tags.ts                                 — Tag.RunResource
src/RunResource.ts                            — RunResource domain tag (Context.Service)
src/RunResourceModule.ts                      — factory barrel (subpath `./RunResource`)
src/internal/runResource/service.ts         — types + RunResourceApi only
```

### Canonical authoring

```ts
import { RunResource } from "../RunResource";

// API 1 + 2 — Tag class
export class RunResourceTelemetry extends Telemetry.Tag<RunResourceTelemetry>(RunResource)(
  "@nikscripts/effect-pm/store/RunResource/RunResourceTelemetry",
  Telemetry.namespace("RunResource"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      RunScope,
      Telemetry.start("Started", RunResourceRunStarted),
      Telemetry.exit({
        onSuccess: Telemetry.event("Completed", RunResourceRunCompleted),
        onFailure: Telemetry.event("Failed", RunResourceRunFailed),
      }),
    ),
  ),
  Telemetry.group("State")(
    Telemetry.event("Changed", RunResourceStateChanged),
  ),
) {}

// API 3
export const runResourceWiring = Wiring.sections(
  Telemetry.extend(RunResourceScope, { waiting: Telemetry.metric.gauge /* … */ }),
  Telemetry.bind(RunResourceTelemetry.Run.run.Started, {
    payload: { concurrency: Telemetry.state.from((s) => s.gateConcurrency) },
  }).pipe(
    Telemetry.logWarning("RunResourceStore write failed for run start", ({ runId }) => ({
      runId: String(runId),
    })),
  ),
  /* every RequiredBindMap entry … */
) satisfies WiringConfig<typeof RunResourceTelemetry>

export const runResourceTelemetryLayer = Telemetry.layer(
  RunResourceTelemetry,
  runResourceWiring,
)

// Barrel — withLayer for kernel (yield* RunResourceTelemetry.*)
// Telemetry.withLayer(RunResourceTelemetry, runResourceTelemetryLayer)
```

### Bind / exhaustiveness rules

- **`PlainFields`** → required keys in **`Telemetry.bind(handle, { … })`**.
- **Define site:** `satisfies WiringConfig<Tag>` (missing keys = normal TS property errors).
- **Layer build:** `Telemetry.layer(tag, wiring)` accepts **`wiring: WiringConfig<Tag>`** only.
- **Per bind:** second arg is **plain field map** (schema-shaped), not `{ bind: … }`.
- **No fake types** like `{ ERROR: "Missing…" }`.
- **`*.test-d.ts`:** `@ts-expect-error` for missing bind, extra keys, wrong leg context.

### Router vs transport (do not conflate)

| Piece | Role |
| --- | --- |
| **`TelemetryRouter`** | Validate + fan-out to sinks |
| **`telemetryTransport`** | Live wire (plan 19) via **`BroadcastSink`** |
| **Facet Tag / wiring** | Definitions + materialize — **not** on router |

---

## Step 1 review (other agent — Jun 2026)

**Commits:** `0d9d52512` (1a DSL foundation), `ac34a9db4` (1b Tag + handles).

**Shipped and good:**

- `src/Telemetry.ts` — `Telemetry.Schema`, tree builders, `Telemetry.Tag` with node handles
- Wire ids: `Namespace.Group.Event` (operation segment excluded) — tested
- `./Telemetry` package export + `test/telemetry-tag.test.ts`
- Tag signature: `Telemetry.Tag<Self>(domain)(facetId, namespace, …tree)`
- `EventNode` branded handles with `wire`, `path`, `schema`

**Gaps (expected for Step 1, not bugs):**

- No wiring / layer / materialize / calling API yet
- RunResource still on debt `defineEvent` (`store/RunResourceTelemetry.ts`)
- Duplicate `Telemetry.Schema` in `src/internal/store/telemetry.ts` (ProcessStore path) — merge when wiring lands

**Fixed in this pass (locked bake decision):**

- **`Telemetry.Schema.Struct`** — full wire payload as `Schema.Struct` (factory-attached static)
- **`Telemetry.Schema.Type`** — now backed by full wire fields (not plain-only subset)
- **`PlainFields`** — `@internal` placeholder until Step 3 wiring types

---

## Locked: `Telemetry.Schema.Struct` (Jun 2026 bake)

| Rule | Lock |
| --- | --- |
| **`.Struct`** | Static on every `Telemetry.Schema` class — factory-built, no author boilerplate |
| **`.Type`** | Full decoded wire payload (same as `Struct.Type`) — **not** plain-only |
| **Field mapping** | Every author field → regular `Schema.*` (scope → underlying schema, terminals → `Number`, etc.) |
| **Nested schemas** | Recursive via nested `Telemetry.Schema` class (A1); cycle → throw at factory time |
| **`PlainFields`** | `@internal` only — wiring exhaustiveness in Step 3, not public API |

**Usage (Store RPC, archive, transport):**

```ts
class RunResourceRunStarted extends Telemetry.Schema<RunResourceRunStarted>()(RunScope)({ … }) {}

RunResourceRunStarted.Struct          // Schema.Struct value
typeof RunResourceRunStarted.Type     // decoded payload type
Procedure.success(RunResourceRunStarted.Struct)
Schema.decodeUnknownSync(RunResourceRunStarted.Struct)(payload)
```

**Do not:** hand-duplicate output schemas in `RunResourceStore.ts` once event schemas port to `Telemetry.Schema`.

**D5 note:** Owner reopened snapshot schema placement — `RunResourceState.ts` is interim until Step 2 uses nested `Telemetry.Schema` + `.Struct` for snapshots.

---

## Replace (branch debt)

| Debt | Target |
| --- | --- |
| `defineEvent` in `RunResourceTelemetry.ts` | `RunResourceTelemetry` Tag + `WiringConfig` |
| `RunResourceIdentity.ts` | **`RunResource`** domain service — delete on R4 |
| `stateRef` counters in `RunResource.ts` | `Telemetry.extend` + wiring |
| **`TelemetryHub`** name in new code | **`TelemetryRouter`** |

---

## Steps (summary)

1. **RunResource service** — [run-resource-service-handoff](./run-resource-service-handoff.md) R1–R4
2. **Step 1** — `Telemetry.Tag` factory with **`(domain)(facetId, …)`** signature
3. **Step 2** — `RunResourceTelemetry` tree port (golden schemas)
4. **Step 3** — `Wiring.sections` + `satisfies WiringConfig`
5. **Steps 4+** — per requirements §5

**Gate:** `pnpm run typecheck && pnpm test && pnpm run lint`
