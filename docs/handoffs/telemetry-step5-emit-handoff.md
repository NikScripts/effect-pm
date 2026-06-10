# Telemetry Step 5+ — State.Root, emit policy, runtime

> **Agent pickup:** **Start here.** Branch checkpoint, resume order, file targets, and acceptance checks for the next implementation slice.

**Path:** `docs/handoffs/telemetry-step5-emit-handoff.md`  
**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Audience:** implementation agent  
**Updated:** Jun 2026 (owner-approved emit policy + branch checkpoint)

**SSoT for API shape:** [telemetry-requirements.md](../recipes/telemetry-requirements.md) — especially **§ 9 Emit policy & config overrides**.  
**State envelope / snapshot:** [state-root-bake.md](../recipes/state-root-bake.md).  
**Issue triage:** [telemetry-branch-issues.md](./telemetry-branch-issues.md).

---

## Branch checkpoint (where the last agent stopped)

**HEAD:** `d5e8c66ef` — `feat(telemetry): Step 4 — operation .provide(scopeLeaf) builder + OperationContext`

**Gate (Jun 2026):** `pnpm run typecheck && pnpm test && pnpm run lint` — **417 tests green**.

| Step | Status | Notes |
| --- | --- | --- |
| **0** Package surface | ⚠️ Partial | `./Telemetry` export ok; **`store/RunResourceTelemetry` subpath missing** (ISSUE-013) |
| **1** Tag factory + Schema | ✅ Done | `src/Telemetry.ts`; `test/telemetry-tag.test.ts` |
| **2** RunResource Tag port | ⚠️ Partial | Tree L260+ correct; **debt:** `defineEvent`, `RunResourceHubTelemetry` same file (Step 8) |
| **3a** Wiring value layer | ✅ Done | `extend` / `bind` / `Wiring.sections` / stub `Telemetry.layer` |
| **3b** PlainFields + exhaustiveness | ✅ Done | `RequiredBindMap`, `BindShape`, `test/telemetry-wiring.test-d.ts` |
| **4** Calling API | ✅ Done | `Effectable.Prototype` EventNode; `.provide(scopeLeaf)`; `OperationContext`; `test/telemetry-calling.test.ts` |
| **5** `internal/telemetry/` runtime | ❌ Not started | **Blocked on `State.Root`** for transition + Changed materialize |
| **6** Runner + real `Telemetry.layer` | ❌ Not started | Stub `Layer.effectDiscard(TelemetryRouter)` today |
| **7–10** Registry, kernel, Queue, cleanup | ❌ Not started | See requirements § 5 |

**Not in repo yet:** `src/internal/telemetry/`, `State.Root`, emit policy markers, policy catalog codegen, module split (`RunResourceTelemetry.wiring.ts` / `.service.ts`).

**Kernel debt unchanged:** `src/internal/runResource/kernel.ts` still uses `RunResourceHubTelemetry` + hand payloads (Step 8).

---

## Read order (implementer)

| # | Doc | Why |
| --- | --- | --- |
| 1 | [telemetry-requirements.md § 9](../recipes/telemetry-requirements.md#9-emit-policy--config-overrides) | **Emit policy + config overrides (owner-approved)** |
| 2 | [state-root-bake.md](../recipes/state-root-bake.md) | Envelope COW, nested snapshot, `State.Changed` materialize |
| 3 | This handoff | Resume order + file targets |
| 4 | [telemetry-branch-issues.md](./telemetry-branch-issues.md) | P0–P2 register (update statuses as you land work) |
| 5 | [telemetry-requirements.md § 5–10](../recipes/telemetry-requirements.md#5-implementation-steps-010) | Step deliverables + acceptance |

**Historical only:** [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) when it contradicts requirements.

---

## Owner-locked — emit policy & config (implement § 9)

### Author-time defaults

| Surface | API | Scope of marker |
| --- | --- | --- |
| **Scope root / leaf** | `State.Scope(…)(fields, scopeDefault?)` / `withLeaf(key, fields, scopeDefault?)` | Third arg → **direct fields in that `{ … }` block only** |
| **Scope field** | `field.pipe(State.debounceEmit(…))` etc. | Overrides scope default for that field |
| **Extend** | `Telemetry.extend(scope, { field: Schema…pipe(marker) })` | Separate registration; scope third arg does **not** apply |
| **Wire event schema** | `Telemetry.Schema(scope, eventSchedule?)({ … })` | Third arg = whole-event schedule; field pipes = **declared plain fields in schema body only** (not selectors, terminals, bind materialized) |

**Markers (v1):** `State.noEmit`, `State.deferEmit`, `State.debounceEmit(duration)`, `State.rateLimitEmit(duration)`, `State.immediateEmit` (or equivalent default tag).

**Internal runtime union:** `EmitPolicy` — `{ _tag: "immediate" \| "never" \| "defer" \| "debounce" \| "rateLimit", … }`.

**Config wire union:** `EmitPolicyOverride` — `"defer"`, `{ debounce: "250 millis" }`, etc. — decodes to same `EmitPolicy`.

### Config overrides (app-facing)

**No `encoding` field.** Tree vs flat by key names + mutual-exclusion types + **`layer` overloads**:

```ts
// tree
RunResourceTelemetry.layer(leaf, wiring, {
  state: { resourceId: { debounce: "250 millis" }, Run: { runId: "defer" } },
  events: { Started: { debounce: "100 millis" } },
})

// flat
RunResourceTelemetry.layer(leaf, wiring, {
  stateFlat: { "Run.runId": "defer", resourceId: { debounce: "250 millis" } },
  eventsFlat: { "Run.run.Started": { debounce: "100 millis" } },
})
```

**Mixing** `state` + `stateFlat` (or `events` + `eventsFlat`) → **compile error**.

**Scope-only:** `RunResourceScope.layer(leaf, { state: … })` or `{ stateFlat: … }` — same types.

**Rejected:** public `configureStateEmit` + manual `Layer.provideMerge` for emit (use optional arg on `layer`; internal `ResourceConfigure.foldConfig` + patch tags ok).

### Type safety (required)

Codegen from a closed **field catalog** per root scope + per event schema:

| Generated on scope class | Generated on Tag / schema |
| --- | --- |
| `defaultStateEmitPolicy` | `defaultEventEmitPolicy` (per schema class) |
| `EmitConfigTree`, `EmitConfigFlat`, `EmitPath` | `EventEmitConfigTree`, `EventEmitConfigFlat` |
| `EmitConfigTreeSchema`, `EmitConfigFlatSchema` | Facet `EmitOverrides` union + `EmitConfig*Schema` |

**Overridable:** author `State.Scope` / `withLeaf` fields only.

**Not overridable (absent from catalog + config types):**

- `Telemetry.extend` fields (`waiting`, `inFlight`, …) — author markers only
- Selectors, terminals, bind materialized fields
- Tag op gates (`State.emit` / `State.noEmit` on Tag tree) — compile-time only in v1

**`State.Changed`:** fan-out driven by **scope field policies** + op gates — **not** via `events` / `eventsFlat` keys.

**Tests:** `*.test-d.ts` — invalid keys, mixed encodings, extend keys in config fail at compile time; Schema decode rejects excess properties.

### Internal plumbing

- Patch tags: `@nikscripts/effect-pm/StateEmit/${scopeId}`, `@nikscripts/effect-pm/EventEmit/${facetId}/…`
- `mergeEmitPolicyTree(defaults, patch)` after normalizing flat → tree
- Facet `Telemetry.layer(tag, wiring, overrides?)` merges scope layer + telemetry layer; registers patches at acquisition

---

## Owner-locked — `State.Changed` & transitions

Canonical spec: [telemetry-requirements.md](../recipes/telemetry-requirements.md) **calling invariant 11** + [state-root-bake.md](../recipes/state-root-bake.md).

| Decision | Lock |
| --- | --- |
| **Trigger** | **`State.transition`** — **not** `yield*` at call sites |
| **Tag surface** | Auto **`State.Changed`** handle (interim explicit `Telemetry.event` ok until Step 6 auto-inject) |
| **COW** | `previous` / `current` always updated — emit policy never skips envelope write |
| **Wire field** | **`operation`** (not hub **`reason`** / `STATE_CHANGE_REASONS`) |
| **Op filter** | `State.emit` / `State.noEmit` on Tag tree; default no emit; inherit |
| **Wiring** | `Telemetry.bind(State.Changed, {}).pipe(…)` — log legs only |

**Open (escalate before coding):** `deferEmit` when **no op frame** is active.

---

## Implementation order

### 1 — `State.Root` in `src/State.ts` (**blocks real emit**)

See [state-root-bake.md](../recipes/state-root-bake.md) and [state-root-telemetry-resume-handoff.md §3](./state-root-telemetry-resume-handoff.md#3--stateroot-locked--implement-in-srcstatets).

Deliverables:

- Envelope `{ previous, current, … }` per scope instance; nested `CurrentShape`
- `yield* Scope` → process-filtered `current`; `yield* State.previous(scope)`; internal `yield* State.Root`
- **`State.transition`** — single `Ref.modify`, COW, schedule `State.Changed` evaluation

Acceptance: unit tests for COW + scope yield views; no kernel migration yet.

### 2 — Emit policy compile (**can parallel types in `State.ts` / `Telemetry.ts`**)

Deliverables:

- Marker metadata on schema fields + scope factory third arg
- Walk scope tree + wiring extend → **`defaultStateEmitPolicy`** (include extend in **defaults**, exclude from **config catalog**)
- Per `Telemetry.Schema` → **`defaultEventEmitPolicy`** + declared-field catalog
- Generated **`EmitConfigTree` / `EmitConfigFlat`** types + matching Schemas
- **`RunResourceTelemetry.EmitOverrides`** + `layer` overloads

Acceptance: `test/emit-policy.test-d.ts` — catalog keys match scope graph; extend keys not in `EmitConfig*`.

### 3 — Step 5 — `src/internal/telemetry/`

Deliverables:

- Materialize (schema + bind + selectors + Exit.*)
- Telemetry-state partition on scope object (`extend` fields)
- Metrics leg; op-scope cleanup
- **`resolveEmitPolicy`** — merge configured overrides + classify transition (debounce timers, defer-to-op-exit, rate windows)
- **`StateChangedEmitter`** optional hook — `Effect.serviceOption` + skip diff when absent (no telemetry tax)

Acceptance: materialize unit tests; policy merge tests with tree + flat overrides.

### 4 — Step 6 — Runner + real `Telemetry.layer`

Deliverables:

- Op runner: start on entry, exit on completion, middle `yield*` materialize
- **`Telemetry.layer(tag, wiring, overrides?)`** — requires **`TelemetryRouter`**; wires runner + emit queue/worker
- **`State.Changed`** materialize from envelope + **`operation`** field (not `reason` literal union)
- Router bridge; bind `logWarning` on archive fail
- Facet export: **`Telemetry.withLayer`** + generated **`RunResourceTelemetry.layer(leaf, wiring, overrides?)`**

Acceptance: integration test — op start/exit reach router; scope field change emits `State.Changed` when policy allows; layer absent → no-op; override debounce on allowed paths only (no defer in overrides v1).

### 5 — D5 snapshot migration (can start before Step 6 if helpful)

[state-root-bake.md § Recipe step 7](../recipes/state-root-bake.md#recipe-step-7--migration-names) — 8-file checklist; nested `RunResourceSnapshotSchema`; add `concurrency` on `RunResourceScope`.

### 6 — Step 8+ — Kernel + debt removal

Replace `RunResourceHubTelemetry` / `defineEvent` / kernel `stateRef` counters; wire `RunResourceTelemetry.layer` at compose.

---

## File targets

```text
src/State.ts                          — State.Root, transition, emit markers, scope third arg, catalog codegen
src/StateEmitConfigure.ts             — optional: foldConfig wrapper + patch tags (internal-friendly)
src/Telemetry.ts                      — schema third arg; layer overloads; policy attach on Schema factory
src/internal/telemetry/               — NEW: materialize, runner, policy table, emit queue
src/store/RunResourceState.ts         — RunResourceSnapshotSchema (nested D5)
src/store/RunResourceScope.ts         — concurrency author field
src/store/RunResourceTelemetry.ts     — debt removal (Step 8); Tag tree
src/store/RunResourceTelemetry.wiring.ts   — NEW: satisfies WiringConfig<Tag>
src/store/RunResourceTelemetry.service.ts  — NEW: facet layer builder
test/emit-policy.test-d.ts            — NEW: config/catalog type proofs
test/telemetry-state-changed.test.ts  — NEW: transition + policy integration (Step 6)
```

---

## Wiring status (RunResource)

**Today:** `test/telemetry-wiring.test.ts` binds `Started` + `Failed` only; **`Completed` bind missing** (ISSUE-011). **`State.Changed`** intentionally omitted until `State.Root` (ISSUE-012).

**Target wiring file:**

```ts
export const runResourceWiring = Wiring.sections(
  Telemetry.extend(RunResourceScope, { … }),
  Telemetry.bind(RunResourceTelemetry.Run.run.Started, { … }),
  Telemetry.bind(RunResourceTelemetry.Run.run.exit.onSuccess, { … }),
  Telemetry.bind(RunResourceTelemetry.Run.run.exit.onFailure, { … }),
  Telemetry.bind(RunResourceTelemetry.State.Changed, {}).pipe(/* log only */),
) satisfies WiringConfig<typeof RunResourceTelemetry>;
```

---

## Issue register — status updates (Jun 2026)

| ID | Was | Now |
| --- | --- | --- |
| ISSUE-008 | Open — `operation<Input>` | **Still open** — generic not required for RunResource pilot |
| ISSUE-009 | Open — nested inherit ops | **Still open** — defer past RunResource |
| ISSUE-010 | Partial Step 4 | **Resolved** — Step 4 landed |
| ISSUE-011 | Missing Completed bind | **Still open** |
| ISSUE-012 | Changed binds deferred | **Still open** — until `State.Root` + auto-materialize |
| ISSUE-017 | State.Root missing | **Still open** — **next critical path** |
| ISSUE-034 | Prototype migration | **Resolved** — `makeEventNode` uses Prototype |

---

## Docs to update in the same PR (when touching runtime)

- [telemetry-branch-issues.md](./telemetry-branch-issues.md) — close resolved issues (ISSUE-010, ISSUE-034, etc.)

---

## Gate before every push

```bash
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```

Full build may surface unrelated dts debt; typecheck + test are mandatory on every commit.

---

## Quick checklist

- [ ] `State.Root` + `State.transition` in `src/State.ts`
- [ ] Emit markers + `defaultStateEmitPolicy` + config catalog types (§ 9)
- [ ] `src/internal/telemetry/` materialize + policy merge
- [ ] Real `Telemetry.layer` + op runner + router bridge
- [ ] `RunResourceTelemetry.layer(leaf, wiring, overrides?)` with tree + flat overloads
- [ ] `*.test-d.ts` for emit config exhaustiveness
- [ ] Integration test: policy + `State.Changed` from transition
- [ ] Requirements doc sync for `State.Changed` — **done in § calling invariant 11** (verify code matches)
