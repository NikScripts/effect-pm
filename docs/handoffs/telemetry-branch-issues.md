# Telemetry branch — issue register

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Worktree:** `effect-pm-alt-transport` (shared)  
**SSoT:** [`docs/recipes/telemetry-requirements.md`](../recipes/telemetry-requirements.md)  
**Handoff:** [`telemetry-step52-transition-handoff.md`](./telemetry-step52-transition-handoff.md) (primary) · [`telemetry-implementation-handoff.md`](./telemetry-implementation-handoff.md) · [`state-root-telemetry-resume-handoff.md`](./state-root-telemetry-resume-handoff.md)  
**Bake:** [`state-transition-op-provide-bake.md`](../recipes/state-transition-op-provide-bake.md) — two-tier branch model, dual API
**Last reviewed:** Jun 2026

Use this register to triage before claiming a step “done.” Gate per requirements: `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

---

## Operations vs events (reference)

**Tag authoring — correct tree shape:**

```ts
// Operation — scope leaf + legs; call site takes op input + .provide()
Telemetry.operation("processEntry")(
  EntryScope,
  Telemetry.start("Started", StartedSchema),     // start leg (runner emits on entry)
  Telemetry.event("Retried", RetriedSchema),     // middle leg (yield* ctx.telemetry.Retried)
  Telemetry.exit({
    onSuccess: Telemetry.event("Completed", CompletedSchema),
    onFailure: Telemetry.event("Failed", FailedSchema),
  }),
),

// Standalone root-scoped fact — group-level event, NOT inside an operation
Telemetry.group("State")(
  Telemetry.event("Changed", ChangedSchema),
),
```

| Rule | Detail |
|------|--------|
| **Start** | `Telemetry.start("…", Schema)` inside an operation — **not** `Telemetry.event("Started", …)` at group level |
| **Middle** | `Telemetry.event("…", Schema)` between start and exit inside the same operation |
| **Exit** | `Telemetry.exit({ onSuccess/onFailure/onInterrupt: Telemetry.event(…) })` — **not** flat group events |
| **Standalone** | `Telemetry.event` at group level for root-scoped facts (e.g. `State.Changed`) |
| **Operation input** | `op(input)` at call site — typed via `Telemetry.operation<Input>` (Step 4; not implemented) |
| **Event input** | **None** — zero-arg `Effect`; materialize from scope, bind, exit, terminals |
| **`.provide()`** | Operations only — never on events |
| **Log pipe legs** | `Telemetry.bind(handle, …).pipe(…)` in wiring — **not** `.pipe` on Tag events |

**Reference implementation (correct):** `src/store/RunResourceTelemetry.ts` (Tag tree, L260–272).

---

## P0 — Merge / gate blockers

### ISSUE-001 — Build gate fails (deterministic service key) — **RESOLVED**

**Was:** Class in `src/internal/runResource/service.ts` with id `@nikscripts/effect-pm/RunResource` → dts build TS25 (`deterministicKeys` expected `@nikscripts/effect-pm/internal/runResource/service/RunResource`).

**Fix (landed):** Split tag vs factory barrel by **actual file path** (rule uses source path, not `package.json` export map):

| File | Role |
| --- | --- |
| `src/RunResource.ts` | **Tag only** — `export class RunResource …("@nikscripts/effect-pm/RunResource")` |
| `src/RunResourceModule.ts` | **Public factory barrel** — docs, type re-exports, `export { RunResource, runResourceLayer } from kernel` |
| `src/internal/runResource/service.ts` | Types + `RunResourceApi` only (no class) |
| `src/internal/runResource/kernel.ts` | Impl, `runResourceApi`, static attach, `runResourceLayer`; imports tag from `../../RunResource` |

**Exports:** `package.json` + `tsup.config.ts` map `./RunResource` → `src/RunResourceModule.ts` (dist `RunResource.*`). Apps keep `@nikscripts/effect-pm/RunResource` and barrel `@nikscripts/effect-pm`.

**Internal tag imports:** `RunResourceScope`, `RunResourceTelemetry`, `Tags.ts` → `./RunResource` (tag file; no kernel import → no init cycle).

**Gate:** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build` — build no longer fails on RunResource deterministic key (unrelated react dts debt may remain).

**Pattern for QueueResource / Process later:** tag class on public `<Name>.ts` path matching service id; factory barrel on separate module if needed.

---

### ISSUE-002 — Main barrel exports legacy `Telemetry` DSL

**Paths:**
- `src/index.ts`
- `src/ProcessStore.ts` → `src/internal/store/telemetry.ts`
- `src/Telemetry.ts` (new DSL — subpath `@nikscripts/effect-pm/Telemetry` only)

**Context:** `import { Telemetry } from "@nikscripts/effect-pm"` gets ProcessStore’s old `namespace/tag/event().pipe()` API. New facet code uses `src/Telemetry.ts`.

**Impact:** Consumers using the barrel author the rejected flat-event + Tag-pipe pattern.

---

### ISSUE-003 — Kernel uses rejected emit path (not operations/events)

**Path:** `src/internal/runResource/kernel.ts`

**Context:** Locked calling invariants (`docs/recipes/telemetry-requirements.md`, calling invariants §):

| Rule | Kernel today |
|------|----------------|
| Zero-arg event Effects | ❌ `RunResourceHubTelemetry.Run.started({ payload })` |
| Runner owns start/exit | ❌ Kernel hand-emits started/completed/failed |
| No hand-built payloads | ❌ Full objects at call site |

**Correct target:**

```ts
yield* RunResourceTelemetry.Run.run
  .provide({ runId })
  .pipe(Effect.flatMap((ctx) => config.effect(input)));
// State.Changed — State.transition (internal), not yield* at kernel
```

**Impact:** Production emit path is pre-bake debt; new Tag unused at runtime (Step 8).

---

### ISSUE-004 — `defineEvent` / `RunResourceHubTelemetry` still public

**Paths:**
- `src/store/RunResourceTelemetry.ts` (~L124–204)
- `src/index.ts` (exports `RunResourceHubTelemetry`)
- Dependents: `src/internal/runResource/kernel.ts`, hub/archive/projection tests

**Context:** Requirements §12 rejects `defineEvent`. Same file hosts correct `RunResourceTelemetry` Tag (L248+).

---

### ISSUE-005 — CHK-17 not met for RunResource pilot

**Paths:**
- **Missing:** `src/store/RunResourceTelemetry.wiring.ts`
- **Partial:** `test/telemetry-wiring.test.ts` (no `satisfies`)
- **Demo-only:** `test/telemetry-wiring.test-d.ts`

**Context:** LOCKED = `Wiring.sections(…) satisfies WiringConfig<Tag>` at define site for pilot + `*.test-d.ts`.

---

## P0 — Operations vs events (authoring & runtime)

### ISSUE-006 — RunResource Tag tree is correct (reference)

**Path:** `src/store/RunResourceTelemetry.ts` (L260–272)

Uses `Telemetry.start` + `Telemetry.exit({ … Telemetry.event … })` on `run`; standalone `State.Changed` at group level. No middle legs on `run` (exit-first) — OK.

**Also correct:** `test/telemetry-tag.test.ts`, `test/telemetry-wiring.test-d.ts`.

---

### ISSUE-007 — Queue / other store facets use wrong flat-event pattern

**Paths:**
- `src/store/queueResourceTelemetry.ts` (L207–347)
- `src/store/processExecution.ts`
- `src/store/processGroup.ts`
- `src/store/processLifecycle.ts`
- `src/store/log.ts`

**Context:** Flat `Telemetry.event("Started"…)` / `Telemetry.event("Completed"…)` at group level + `.pipe` on Tag — rejected. Should migrate to `start` / middle `event` / `exit` inside operations (see requirements § Queue).

**Impact:** Slice E blocked; files teach wrong pattern.

---

### ISSUE-008 — `Telemetry.operation<Input>` not implemented

**Path:** `src/Telemetry.ts` (L355–365)

**Context:** Spec: `Telemetry.operation<{ attempts: number }>("processEntry")(…)`. Factory: `operation(name)(scope, …parts)` — no Input generic.

**Impact:** Step 4 cannot typecheck `op(input)` vs event payloads.

---

### ISSUE-009 — Nested scope-inheriting ops (e.g. `rateLimit`) not implemented

**Paths:**
- `src/Telemetry.ts` — `operation()` always requires `scope`
- `docs/recipes/telemetry-requirements.md` (L377–379)
- `docs/recipes/telemetry-split-bake.md` (L320–340)

**Context:** Spec shows `Telemetry.operation("rateLimit")({ onFailure: … })` — invalid against shipped factory. Nested inherit-parent-scope ops not supported.

**Target once built:**

```ts
Telemetry.operation("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", …),
  Telemetry.operation("rateLimit")(
    Telemetry.exit({ onFailure: Telemetry.event("Exceeded", …) }),
  ),
  Telemetry.exit({ … }),
);
```

---

### ISSUE-010 — Step 4 calling API missing

**Path:** `src/Telemetry.ts` (Tag factory — handles only)

**Context:** `EventNode` + `makeEventNode` use **`Effectable.Prototype`**. `.provide(scopeLeaf)`, `OperationContext`, op builder on Tag — **landed** (`test/telemetry-calling.test.ts`).

**Status:** ✅ **Resolved** (Step 4)

---

### ISSUE-034 — `makeEventNode` should use `Effectable.Prototype` (v4 idiomatic)

**Path:** `src/Telemetry.ts` (`makeEventNode`, TSDoc ~L491–525)

**Context:** Effect v4 idiomatic pattern is `Effectable.Prototype({ label, evaluate })` + `Object.create` — landed in `makeEventNode`.

**Status:** ✅ **Resolved**

---

### ISSUE-011 — Incomplete RunResource wiring (missing onSuccess bind)

**Path:** `test/telemetry-wiring.test.ts` (L15–31)

**Context:** Missing bind for `RunResourceTelemetry.Run.run.exit.onSuccess` (`Completed` has `payload` → required by `RequiredBindMap`). Test avoids `satisfies`.

---

### ISSUE-012 — `State.Changed` binds deferred vs `RequiredBindMap`

**Paths:**
- `src/store/RunResourceTelemetry.ts` (`RunResourceStateChanged`)
- `test/telemetry-wiring.test.ts`
- `docs/handoffs/state-root-telemetry-resume-handoff.md` §2

**Context:** Plain fields on schema require bind for exhaustiveness until `State.Root` materialize lands. Do **not** use owner-rejected `pending*` scratch fields.

---

## P1 — Spec deliverables & layout

### ISSUE-013 — Missing `store/RunResourceTelemetry` export

**Paths:** `package.json`, `tsup.config.ts`

---

### ISSUE-014 — Module split missing

**Missing:**
- `src/store/RunResourceTelemetry.wiring.ts`
- `src/store/RunResourceTelemetry.service.ts`

**Present:** monolithic `src/store/RunResourceTelemetry.ts`

---

### ISSUE-015 — `WiringConfig` missing `tag` field

**Path:** `src/Telemetry.ts` (L846–850) — spec includes `readonly tag: Tag["id"]`.

---

### ISSUE-016 — `Telemetry.layer` not paired with Tag

**Path:** `src/Telemetry.ts` (L891–895) — `_tag: unknown`, unparameterized `WiringConfig`.

---

### ISSUE-017 — `State.Root` not implemented

**Path:** `src/State.ts` (missing) — see handoff §2. Blocks Step 5–6.

---

### ISSUE-018 — Duplicate `Telemetry.Schema` in ProcessStore path

**Path:** `src/internal/store/telemetry.ts`

---

## P1 — Wiring / types (Step 3b)

### ISSUE-019 — `Telemetry.annotateLogs` pipe leg missing

**Path:** `src/Telemetry.ts` — only `logWarning` / `logInfo` / `logError`.

---

### ISSUE-020 — Field source naming drift

**Path:** `src/Telemetry.ts` (`Telemetry.source.*`)

Spec prose: `Operation.input`, `Exit.*`, `Clock.now`. Shipped: `Telemetry.source.input` / `.exit` / `.clock`.

---

### ISSUE-021 — `test-d.ts` incomplete

**Path:** `test/telemetry-wiring.test-d.ts`

Missing: extra bind keys, wrong log-leg context (per requirements Step 3).

---

### ISSUE-022 — `Telemetry.BindShape<S>` not committed

**Paths:** local diff on `src/Telemetry.ts`, docs — owner lock to obscure bind shape on schema classes.

---

## P1 — Schema model

### ISSUE-023 — `Telemetry.input` on schema ≠ operation input

**Path:** `src/Telemetry.ts`

Schema `Telemetry.input.*` = wire field from op input at materialize. Not call-site event args.

---

### ISSUE-024 — `RunResourceStateChanged.id` is plain string

**Path:** `src/store/RunResourceTelemetry.ts` (~L241) — align with `State.Root` materialize plan.

---

## P2 — Documentation drift

### ISSUE-025 — Handoff status table stale

**Path:** `docs/handoffs/state-root-telemetry-resume-handoff.md`

**Status:** ⚠️ Superseded by Jun 2026 primary handoff rewrite — use §9 issue register there.

---

### ISSUE-026 — Requirements checklist open

**Path:** `docs/recipes/telemetry-requirements.md` (L54–60, L1328–1338)

---

### ISSUE-027 — Requirements wiring example uses rejected scratch fields

**Path:** `docs/recipes/telemetry-requirements.md` (L615–619) — `pendingPreviousSnapshot`, etc.

---

### ISSUE-028 — Invalid `rateLimit` syntax in requirements / bake docs

**Paths:**
- `docs/recipes/telemetry-requirements.md` (L377–379)
- `docs/recipes/telemetry-split-bake.md`

---

### ISSUE-029 — Stale “loosely typed bind” comment

**Path:** `src/Telemetry.ts` (L571–573)

---

### ISSUE-030 — Recon/bake docs show flat `Telemetry.event("Started")`

**Paths:** `docs/recipes/telemetry-recon-findings.md`, `docs/handoffs/telemetry-split-bake-prompt.md`

---

## P2 — Repo rules

### ISSUE-031 — No changeset for public telemetry API

**Path:** `.changeset/`

---

### ISSUE-032 — `Tags.ts` exports kernel-attached RunResource

**Path:** `src/Tags.ts` — vs bare `service.ts` tag (CHK-14 nuance).

---

### ISSUE-033 — CHK-16 router rename incomplete

**Paths:** `src/TelemetryHub.ts`, `src/TelemetryRouter.ts`, kernel `TelemetryHubError` types.

---

## Suggested fix order

1. ~~ISSUE-001 — build / deterministic keys~~ ✅  
2. ISSUE-005, 011, 014 — pilot wiring file + `satisfies` + complete binds  
3. ISSUE-034, 028, 027, 025 — EventNode Prototype + fix spec/handoff examples  
4. ISSUE-008, 009, 010 — Step 4 + nested ops  
5. ISSUE-003, 004, 007 — kernel + debt + Queue migration  
6. ISSUE-017 — `State.Root` before runtime materialize  

---

## Index entry

Listed in [`docs/handoffs/README.md`](./README.md) under telemetry impl agent.
