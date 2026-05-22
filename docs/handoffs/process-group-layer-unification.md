# Handoff: ProcessGroup layer unification & dependency typing

**Date:** 2026-05-21  
**Status:** Investigation complete; layer helpers may be partial; endpoint DX specified  
**Endpoint DX:** [process-group-endpoint-dx.md](../plans/process-group-endpoint-dx.md) — canonical third arg, pre-1.0 removals, alternatives when canonical cannot apply.  
**Primary goal:** Unify groups so **as much wiring as possible lives in the group definition file** (processes, queues, endpoints, env layer, `LocalRuntime`) — not scattered `mergeAll` / duplicate queue-store layers.

---

## Executive summary

`effect-pm`’s typed `ProcessGroup.Service` **auto-bundles queue layers** into `group.layer` but **does not bundle process layers**. Queue tags intentionally remain in the layer **requirement channel** (`R`) after a re-merge so callers can `yield* JobQueue` after `yield* Group`. That design causes:

- Verbose **`workshopEnvLayer` / `analyticsEnvLayer`** with duplicate `JobQueue.layer` and `ProcessStore.layer`
- **False-positive** `@effect/language-service` diagnostics (`missingEffectServiceDependency`, `leakingRequirements`) on child runtimes using `Effect.never.pipe(Effect.provide(control.pipe(Layer.provide(layer))))`
- A **public type lie**: `ProcessGroupServiceDefinition.layer` declares `ProcessGroupServiceLayerRequirements` but implementation returns `ProcessGroupServiceLayerProvided` (wider)

Runtime behavior is generally **correct** when layers are composed like the test fixture; the pain is **DX, typing, and asymmetry** (queues vs processes).

---

## Background: what was built

### ProcessManager playground (`examples/scenarios/process-manager-playground/`)

Demonstrates two groups (`WorkshopGroup`, `AnalyticsGroup`) with:

- `ProcessGroup.Service` + bundled endpoint config (3rd arg)
- `ProcessManager.LocalRuntime` + `ControlService.layerHttp`
- `Endpoint.module` → dynamic `import("./workshop-runtime.js")` (NodeNext requires `.js` extension)
- Thin `*-runtime.ts` child entries (re-export runtime, `Effect.never` + provide control/layer)

**Run:**

```bash
pnpm run demo:pm -- groups
pnpm run demo:pm -- group-start workshop-group   # terminal 2
pnpm run demo:pm -- start workshop/feeder        # terminal 1
```

### Circular typing workaround (do not regress)

`Endpoint.module(() => import("./workshop-definition"))` **inside the same file** as `class WorkshopGroup` causes **TS2310** (recursive base type). **Required pattern:**

1. **Runner module** (`workshop-runtime.ts`) re-exports `WorkshopRuntime` from definition
2. Endpoints import **`./workshop-runtime.js`**, not definition
3. **`workshopGroupEndpoints()` helper** returning explicit `readonly ProcessManagerGroupConfigItem[]` — even with runner import, TS may still trace definition → runner → definition

See `test/fixtures/process-manager-module-definition.ts` + `process-manager-module-runner.ts` and `test/process-manager.test.ts` (`group-start`).

### Plan alignment (`docs/plans/07-process-manager.md` ~824–839)

Intended split:

1. **Group file** — declarations + optional lazy endpoint descriptors  
2. **Runtime descriptor** — live layers + `ControlService`  
3. **CLI** — reads descriptors, launches child, sends protocol commands  

**User direction (new):** Push step 2 **into** the group definition as much as possible — ideally `BillingRuntime` is derivable from `BillingGroup` without a separate env-layer recipe every app copies.

---

## Root cause analysis

### 1. Queues get special treatment in types

| Mechanism | Location | Behavior |
|-----------|----------|----------|
| `TypedProcessGroupQueueRequirements` | `ProcessGroup.ts` ~163–167 | Queue **tag classes** required for `make` / build |
| `queueContributionLayersFrom` | ~1490–1505 | Collects `.layer` from queue entries |
| Build | ~1546–1547 | `baseLayer.pipe(Layer.provide(bundledForBuild))` |
| Re-merge | ~1548–1550 | `Layer.merge(built, bundledForBuild)` — **keeps queue tags in `R`** for control handlers |
| `ProcessGroupServiceLayerProvided` | ~196–197 | `Requirements \| BundledQueueLayerContext` |
| `ProcessGroupEntryRequirements` | ~212–214 | **Processes only** — union of process effect `R` (e.g. `Feeder` → `JobQueue`) |

**Processes** are never merged into `ProcessGroup.Service.layer`. Apps must `Layer.provide(Feeder.layer, …)` manually.

**ControlService.layerHttp** requires:

```text
Self | ProcessGroupEntryRequirements<Entries> | ProcessStore
```

So `JobQueue` appears because **`Feeder`’s effect** needs it, not because the queue entry is missing from the group bundle.

### 2. Playground env layer (current — redundant)

`workshop-definition.ts`:

```typescript
export const workshopEnvLayer = Layer.mergeAll(
  WorkshopGroup.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Feeder.layer.pipe(Layer.provide(JobQueue.layer)),
        JobQueue.layer,      // duplicate of bundled queue
        ProcessStore.layer,
      ),
    ),
  ),
  JobQueue.layer,            // duplicate — typing workaround
  ProcessStore.layer,        // duplicate
);
```

**Guide-recommended minimal shape** (not yet applied; verify LS + runtime):

```typescript
export const workshopEnvLayer = WorkshopGroup.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Feeder.layer.pipe(Layer.provide(JobQueue.layer)),
      ProcessStore.layer,
    ),
  ),
);
```

Same for `analyticsEnvLayer` in `analytics-definition.ts`.

### 3. False “missing dependency” diagnostics

- **`@effect/language-service`** in root `tsconfig.json`: `leakingRequirements`, `missingEffectServiceDependency` = **error**; `strictEffectProvide` = **off**
- Child runner: `Effect.never.pipe(Effect.provide(WorkshopRuntime.control.pipe(Layer.provide(WorkshopRuntime.layer))), Effect.scoped)`
- When `WorkshopGroup` inference broke (circular import), types collapsed to **`any`** → nonsense missing-service errors
- With healthy types, remaining noise is **`R` channel not narrowing to `never`** on fully composed layers — not missing runtime services

### 4. Known unrelated typecheck failures (fix opportunistically)

```
src/ControlService.ts(184,73): ConfigItems not assignable to readonly []
test/queue-resource-api.test-d.ts(11,1): floating Effect (TS3 plugin)
```

`controlServiceLayerFromGroup` / `layerHttp` — generic `ConfigItems` on groups with bundled endpoint config.

---

## Target end state (“unify in group definition”)

A developer should be able to write **one file** (or definition + thin runner only) like:

```typescript
export class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [SyncInvoices, EmailQueue] as const,
  billingEndpoints(),
) {}

// Ideal — names TBD:
export const BillingRuntime = BillingGroup.localRuntime({
  port: 3001,
  store: ProcessStore.layer, // or default in library
});
```

Where **`BillingGroup.localRuntime`** (or `ProcessManager.LocalRuntime(BillingGroup, BillingGroup.runtimeConfig())`) internally:

1. Bundles **process layers** for entries (symmetric to queues), satisfying each process’s `R` from group queue tags
2. Provides **ProcessStore** by default (overridable)
3. Builds **control** via `ControlService.layerHttp` with **closed** requirement types when env is closed
4. Exports **`LocalRuntime`** descriptor for `Endpoint.module`
5. Keeps **endpoint config** on the group (3rd `ProcessGroup.Service` arg) without circular imports (runner import pattern stays)

**Non-goals for first slice:**

- Changing remote HTTP contract
- Bundling unrelated app services into group layer
- Removing queue re-merge without proving control router still works

---

## Solution options (ordered)

### Phase A — Playground + docs (low risk)

1. Simplify `workshopEnvLayer` / `analyticsEnvLayer` to single `pipe` + `provide` (no root duplicate queues)
2. Update `examples/scenarios/process-manager-playground/README.md` layer section
3. Run `pnpm exec tsc --noEmit`, Effect LS on `*-runtime.ts`, `pnpm run demo:pm -- group-start …`

### Phase B — Type honesty (small API)

1. Change `ProcessGroupServiceDefinition.layer` to **`ProcessGroupServiceLayerProvided<Entries>`** (or export both `layer` and `layerBuildRequirements`)
2. Fix `ControlService` `ConfigItems` generic at line ~184

### Phase C — Composition helper (best DX)

Add e.g. **`ProcessGroup.localEnvLayer(group, options)`** or **`group.runtimeLayer({ processes?, store?, port? })`**:

- Input: group service class + optional overrides
- Output: layer typed to satisfy `ControlService.layerHttp(group, …)` when piped correctly
- Document in `docs/guides/process-group.md` and `process-manager.md`
- Update test fixture + playground to use it

### Phase D — Structural unification (larger, semver)

1. **Bundle process layers** into `ProcessGroup.Service.layer` (mirror `queueContributionLayersFrom`)
2. Revisit **re-merge** typing — separate `layer` vs `layerWithHandlers` if needed
3. Narrow **`ControlService.layerHttp`** when runtime layer is known closed

---

## Key files

| Path | Role |
|------|------|
| `src/ProcessGroup.ts` | Queue bundling, `ProcessGroupServiceLayer*`, `ProcessGroup.Service` factory ~1507–1560 |
| `src/ControlService.ts` | `layerHttp`, `layerFromGroup`, `ConfigItems` bug ~184 |
| `src/ControlProtocol.ts` | Router context `ProcessGroupEntryRequirements \| ProcessStore` |
| `src/ProcessManager.ts` | `LocalRuntime` descriptor (~153–168) |
| `examples/scenarios/process-manager-playground/` | Reference app — simplify env layers |
| `test/fixtures/process-manager-module-definition.ts` | Minimal `LocalRuntime` (only `TypeGroup.layer` — processes have `never` R) |
| `test/process-group-typed.test.ts` | Typed group tests |
| `docs/guides/process-group.md` | Documents `BillingGroup.layer.pipe(Layer.provide(...))` |
| `docs/guides/process-manager.md` | `LocalRuntime` section |
| `docs/plans/07-process-manager.md` | Architecture + circular dependency guidance |
| `AGENTS.md` / `docs/AGENTS.md` | Verification commands, vendored `repos/effect/` |

---

## Verification checklist

```bash
pnpm exec tsc --noEmit
pnpm test test/process-group-typed.test.ts
pnpm test test/process-manager.test.ts   # group-start / module endpoint
pnpm run demo:pm -- group-start workshop-group
pnpm run demo:pm -- ls
pnpm run demo:pm -- start workshop/feeder
```

Watch for:

- `leakingRequirements` on `*-runtime.ts`
- `layerMergeAllWithDependencies` if reintroducing `mergeAll`
- TS2835 on dynamic imports without `.js` under `moduleResolution: "NodeNext"`

---

## Constraints for implementers

1. **Explain before changing** `workshop-definition.ts` / tsconfig — user has been burned by silent edits  
2. **No type casts** — user rule: absolutely safe typing  
3. **Do not edit `repos/`** vendored trees  
4. **No git commit** unless user asks; **changeset** if public API changes (`ProcessGroup`, `ControlService`, new helpers)  
5. **Runner import pattern** for `Endpoint.module` is mandatory — do not revert to self-import of definition  
6. Inspect **`repos/effect/`** for Layer/provide idioms before guessing  

---

## Agent takeover prompt

Copy everything below this line into a new agent session.

---

You are taking over work on **`@nikscripts/effect-pm`** (package root: workspace with `src/`, `test/`, `examples/`, `docs/`). Read **`docs/handoffs/process-group-layer-unification.md`** first, then **`docs/AGENTS.md`** for verification commands.

### Mission

**Unify ProcessGroup wiring** so developers can do **as much as possible in the group definition file** — processes, queues, endpoint config, env/runtime layer, and `ProcessManager.LocalRuntime` — without copy-pasted `Layer.mergeAll` recipes and duplicate queue/store layers.

The reference app is **`examples/scenarios/process-manager-playground/`** (`pnpm run demo:pm`). It must keep working after your changes.

### Problem statement

Today:

- **Queues** are auto-bundled into `ProcessGroup.Service.layer` and re-merged so queue tags stay in the layer `R` channel (`src/ProcessGroup.ts` ~1545–1550).
- **Processes** are **not** bundled; apps manually `Layer.provide(Feeder.layer.pipe(Layer.provide(JobQueue.layer)), ProcessStore.layer, …)` and often **duplicate** `JobQueue.layer` at the root for the type checker.
- **`ControlService.layerHttp`** requires `Self | ProcessGroupEntryRequirements | ProcessStore`, so process dependencies (e.g. `JobQueue` from `Feeder`) appear again even when queues are group entries.
- **`ProcessGroupServiceDefinition.layer`** public type does not match implementation (`Requirements` vs `Provided`).
- **`@effect/language-service`** may report missing `JobQueue` / `CounterQueue` on child runtimes (`Effect.never.pipe(Effect.provide(control.pipe(Layer.provide(layer))))`) when types don’t narrow to `never` — often a typing issue, not runtime.

### Hard constraints

1. **Do not break the circular-import pattern:** `Endpoint.module` must import a **runner** module (`workshop-runtime.js`), not the definition file that declares `WorkshopGroup`. Keep `*GroupEndpoints()` helpers if needed for TS2310.
2. **NodeNext:** dynamic `import()` paths need **`.js`** extension unless you introduce a scoped `examples/tsconfig` with `bundler` (discuss with user first).
3. **No unsafe casts.** Prefer library typing fixes and helpers.
4. **Minimal scope per PR slice** — user prefers phased delivery.
5. **Changeset** if you change public exports in `src/`.
6. **Do not commit** unless the user explicitly asks.

### Suggested implementation order

**Slice 1 (playground + docs):**  
Simplify `workshopEnvLayer` and `analyticsEnvLayer` to:

```typescript
Group.layer.pipe(Layer.provide(Layer.mergeAll(
  Process.layer.pipe(Layer.provide(Queue.layer)), // per process
  ProcessStore.layer,
)))
```

Remove root duplicate queue/store merges. Verify `tsc`, language service on `workshop-runtime.ts` / `analytics-runtime.ts`, and `pnpm run demo:pm -- group-start`.

**Slice 2 (types):**  
Align `ProcessGroupServiceDefinition.layer` with `ProcessGroupServiceLayerProvided`. Fix `ControlService.ts` line ~184 `ConfigItems` assignability.

**Slice 3 (API — goal):**  
Add a **`ProcessGroup` runtime composition helper** (name TBD, e.g. `localEnvLayer` / `runtimeLayer`) so a group definition can export:

```typescript
export const WorkshopRuntime = ProcessManager.LocalRuntime(WorkshopGroup, {
  layer: WorkshopGroup.localEnvLayer({ store: ProcessStore.layer }),
  control: ControlService.layerHttp(WorkshopGroup, { port: workshopPort }),
});
```

or even a single `WorkshopGroup.localRuntime({ port })` if you can close types cleanly. Update `docs/guides/process-group.md`, test fixture, and playground.

**Slice 4 (optional, larger):**  
Bundle process layers into `ProcessGroup.Service.layer` like queues; revisit re-merge and `ControlService` requirements.

### Success criteria

- Playground env layers are **short and obviously correct** (no duplicate queue layers unless proven necessary).
- Child runtime files typecheck without **false** missing-service errors (or document remaining LS limitations).
- Guides show **one canonical pattern** aligned with code.
- `pnpm exec tsc --noEmit` clean (including fixing existing `ControlService` `ConfigItems` error).
- Tests + `demo:pm` group-start / controls pass.
- Public API changes have a **changeset**.

### When stuck

- Read `repos/effect/` for Layer merge/provide typing patterns.  
- Compare `test/fixtures/process-manager-module-definition.ts` (simple) vs playground (process deps).  
- Grep `ProcessGroupServiceLayerProvided`, `queueContributionLayersFrom`, `layerFromGroup` in `src/`.

Report back with: what you changed, typing behavior before/after, and whether further unification needs a breaking change.
