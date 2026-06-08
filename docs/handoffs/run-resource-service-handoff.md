# RunResource module service — implementation handoff

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Audience:** implementation agent  
**Scope:** **`RunResource` only** — make the worker module a real `Context.Service`; wire tag/kernel/barrel/`Tags.ts`; migrate off `RunResourceIdentity`.  
**Out of scope:** QueueResource, Process, telemetry Tag factory, wiring, wire namespace rules, store facet shapes (unless a file must import the domain tag).

**Related (do not redesign here):**

- Telemetry API / wires: [telemetry-requirements.md](../recipes/telemetry-requirements.md)
- Telemetry implementation order: [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md)
- Scope vocabulary: [18-resource-state-scope.md](../plans/18-resource-state-scope.md)

---

## Read order

| Order | Doc | Use for |
| --- | --- | --- |
| 1 | **This doc** | Locked RunResource-as-service layout |
| 2 | [telemetry-open-decisions-bake.md](../recipes/telemetry-open-decisions-bake.md) | Superseded identity notes + telemetry-only open items |
| 3 | Current `src/RunResource.ts` | Implementation to move into kernel |

**Gate (this track):** `pnpm run typecheck && pnpm test && pnpm run lint`

(`pnpm run build` may still fail on unrelated debt — same as Step 0 report.)

---

## Locked decisions

### 1. Domain module = real `Context.Service` (not namespace + identity file)

- **`RunResource` is a `Context.Service` class** with id `@nikscripts/effect-pm/RunResource`.
- **Not** a hollow type anchor. **Not** a separate `RunResourceIdentity.ts`.
- The service **shape** is the current public factory API (`make`, `layer`, `Service`, `Tag`, `makeRunner`) typed as **`RunResourceApi`** (explicit interface — no `typeof` from kernel on the tag file).
- **`runResourceLayer`** provides that shape via `Layer.succeed(RunResource, runResourceApi)` (stateless).
- **Backward compatible:** callers keep `RunResource.make`, `RunResource.Service<…>()(…)`, `class X extends RunResource.Tag<…>()(…)`, etc.

### 2. Tag file and kernel are separate modules (one-way dependency)

```
internal/runResource/service.ts   — class RunResource + public types + RunResourceApi
internal/runResource/kernel.ts    — gate impl, factories, runResourceApi, runResourceLayer
RunResource.ts                    — public barrel (re-exports only)
```

**Dependency rule:**

- **`service.ts` must not import `kernel.ts`** (top-level).
- **`kernel.ts` imports `RunResource` from `service.ts`** — implementation may depend on the domain tag (and will depend on scope/telemetry modules as today).
- **No circular imports.**

### 3. Statics wiring lives in kernel (not the public barrel)

- Build **`runResourceApi`** object (`satisfies RunResourceApi`).
- Attach to the class **once in kernel** via `Object.assign(RunResource, runResourceApi)` **or** lazy static getters on the class in `service.ts` that delegate to kernel on first use (see [Optional hardening](#optional-hardening-lazy-static-getters)).
- **`RunResource.ts` must not** contain `RunResource.make = …` assignment lines — only re-exports.

### 4. External exports

| Subpath | Export | Purpose |
| --- | --- | --- |
| `@nikscripts/effect-pm/RunResource` | `RunResource`, types, `runResourceLayer` | Factory API (apps) |
| `@nikscripts/effect-pm/Tags` | `Tag` namespace | Tag classes for filters (ProcessStore, etc.) |

```ts
// Tags.ts
export namespace Tag {
  export { RunResource } from "./internal/runResource/service";
}
```

- **`Tag.RunResource`** is the **only external tag entry point** for cross-module filter inputs.
- **No public subpath** for `internal/runResource/service.ts`.
- **Remove** `./RunResourceIdentity` export when migration completes.

### 5. Internal tag access

In-repo modules (Scope, telemetry, kernel) import the class **directly**:

```ts
import { RunResource } from "./internal/runResource/service";
```

`Tags.ts` is **not** required for internal use — it aggregates tags for **external** consumers.

### 6. Naming

| Rule | Lock |
| --- | --- |
| Domain class name | `RunResource` |
| Domain service id | `@nikscripts/effect-pm/RunResource` |
| Domain layer export | **`runResourceLayer`** (camelCase, suffix `layer`) |
| No `*Live`, no PascalCase layer names | e.g. not `RunResourceLive` |
| No product/export named `RunResourceTag` | That name was a filename mistake — the class is **`RunResource`** |
| No `"Tag"` in domain service id strings | Already satisfied |

### 7. User gate services (unchanged behavior)

- **`RunResource.Service<Self, T, A, E>()(name, config)`** — user gate tag + baked `.layer`, `configure`, `wrapGate`.
- **`RunResource.Tag<Self, T, A, E>()(name)`** — user gate identity only.
- **`RunResource.layer(userTag, config)`** — layer builder for user gates (name kept; **not** the domain `runResourceLayer`).
- **`RunResource.makeRunner({ name, concurrency })`** — runner tag + layer.

These remain **separate `Context.Service` keys** per user gate (`@app/…`), created by factories on the domain module.

### 8. `RunResourceScope` — class + domain tag (not const, not identity string)

**Target** (requires `State.Scope` API change — see [Open](#open-decisions)):

```ts
import { RunResource } from "./internal/runResource/service";

class RunResourceScope extends State.Scope(RunResource)({
  resourceId: Schema.String,
});
```

- **Class**, not `export const`.
- **Pass `RunResource` the service class** — not a string, not `.key`, not `RunResourceIdentity.TypeTag`.
- **`RunScope`** remains a **class** leaf (e.g. `class RunScope extends RunResourceScope.withLeaf(…)`).

Plan 18 already describes class-style scopes; **`src/State.ts` still implements the old** `State.Scope(kind, fields)(id)` const factory — implementer must align `State.ts` with plan 18 + this signature.

### 9. Delete `RunResourceIdentity.ts`

- Remove `src/RunResourceIdentity.ts`.
- Remove `package.json` / `tsup.config.ts` entries for `./RunResourceIdentity`.
- Update `RunResourceScope.ts` and any imports of `RunResourceIdentity`.
- **Do not** replace with another hand-maintained identity module.

### 10. Explicit non-goals (do not change)

- **`Telemetry.namespace("RunResource")`** — wire-only; unchanged.
- Wire ids from **`Namespace.Group.Event`** — do not derive from `RunResource.key`, `split("/")`, or domain tag strings.
- **Do not modify** `Telemetry.Tag` factory behavior in this track.
- **QueueResource**, **Process** — not part of this handoff (same pattern may apply later).
- Store / telemetry facet architecture — separate telemetry steps.

---

## Target module layout

```text
src/
  RunResource.ts                         — public barrel
  Tags.ts                                — Tag namespace (new)
  RunResourceScope.ts                    — class scopes (after State.Scope)
  internal/runResource/
    service.ts                           — RunResource class + RunResourceApi + types
    kernel.ts                            — impl + runResourceApi + runResourceLayer + static attach

# Remove:
  RunResourceIdentity.ts
```

### `service.ts` (tag + types)

- All current public types: `RunGate`, `RunResourceConfig`, `RunResourceDefinition`, etc.
- `RunResourceApi` interface (explicit signatures).
- `export class RunResource extends Context.Service<RunResource, RunResourceApi>()("@nikscripts/effect-pm/RunResource") {}`
- Optional: lazy static getters (see below). No kernel import at top level unless using getters.

### `kernel.ts` (implementation)

- Move `makeRunGateEffect`, `makeRunnerEffect`, user-gate factories from current `RunResource.ts`.
- `export const runResourceApi = { … } satisfies RunResourceApi`
- `Object.assign(RunResource, runResourceApi)` (if not using getters-only)
- `export const runResourceLayer = Layer.succeed(RunResource, runResourceApi)`
- `export { RunResource }` (same constructor reference after assign)

### `RunResource.ts` (barrel)

```ts
export type { … } from "./internal/runResource/service";
export { RunResource, runResourceLayer } from "./internal/runResource/kernel";
```

---

## Optional hardening: lazy static getters

If statics are attached only via `Object.assign` in kernel, importers of **`service.ts` alone** see a bare class (no `.make`). That is fine for Scope (identity only).

To make statics work regardless of import path, define getters on the class in **`service.ts`**:

```ts
const api = (): RunResourceApi => require("./kernel").runResourceApi;
// static get make() { return api().make; } …
```

**Not locked** — implementer may ship kernel-only attach + internal-only `service.ts` import policy first.

---

## Implementation sequence

| Step | Work | Depends on |
| --- | --- | --- |
| **R1** | Add `internal/runResource/service.ts` + `kernel.ts`; split current `RunResource.ts` | — |
| **R2** | Wire barrel; verify examples/tests still use `RunResource.make` / `.Service` / `.Tag` | R1 |
| **R3** | Add `Tags.ts` + `package.json` / `tsup` export | R1 |
| **R4** | Remove `RunResourceIdentity.ts` + export | R1, scope migration |
| **R5** | **`State.Scope` refactor** → `State.Scope(DomainTag)(fields)` + class `extends` | Owner-locked signature |
| **R6** | Migrate `RunResourceScope` / `RunScope` to classes + `RunResource` tag | R1, R5 |

Telemetry Step 1+ should **import `RunResource` from internal service** for `Telemetry.extend(RunResourceScope, …)` after R6.

---

## Open decisions

| ID | Question | Owner notes |
| --- | --- | --- |
| **O1** | **`State.Scope` exact signature** | Locked intent: `class X extends State.Scope(RunResource)({ fields })`. Implementer must update `src/State.ts` + plan 18 examples. Confirm `withLeaf` returns extendable class, child id string rules unchanged. |
| **O2** | **Lazy getters vs kernel-only `Object.assign`** | Policy-only (internal `service.ts`) vs getters (bulletproof). Either acceptable for v1. |
| **O3** | **`runResourceLayer` compose** | Is domain layer merged in `ProcessGroup.localEnvLayer` by default, or opt-in at app compose? Current namespace API needs no domain layer for static factories. |
| **O4** | **`RunResourceApi` instance vs empty** | Layer can provide full `runResourceApi` or `{}` if only statics matter. Locked: layer **may** provide full api for `yield* RunResource` parity. |
| **O5** | **`Tags.ts` subpath** | Confirm `./Tags` export path and barrel re-export from main index (if any). |
| **O6** | **Telemetry facet class name** | **Locked:** **`RunResourceTelemetry`** (not `RunResourceTag`). Tag signature: **`Telemetry.Tag<Self>(RunResource)(facetId, Telemetry.namespace(...), tree)`**. |

---

## Rejected (this track)

- Hand-maintained `RunResourceIdentity.ts` (`TypeTag` / `TypeId` / `Kind`)
- Hollow domain anchor service (tag with no `RunResourceApi`)
- Public subpath for internal `service.ts`
- Export name / class `RunResourceTag` for the **domain** module
- Deriving wire namespace from domain tag string (`split`, `.key`, etc.)
- Wiring statics in `RunResource.ts` barrel via five assignment statements
- `RunResourceLive` or PascalCase layer export names
- `export const RunResourceScope = …` (must be **class** after `State.Scope` work)
- Changing QueueResource / Process in the same PR

---

## Acceptance checks

- [ ] `import { RunResource } from "@nikscripts/effect-pm/RunResource"` — `make`, `Service`, `Tag`, `layer`, `makeRunner` unchanged for existing tests/examples
- [ ] `import { Tag } from "@nikscripts/effect-pm/Tags"` — `Tag.RunResource` is `Context.Service` class with id `@nikscripts/effect-pm/RunResource`
- [ ] `RunResourceIdentity` removed; no broken exports
- [ ] `internal/runResource/service.ts` importable from Scope without loading kernel (identity); kernel loads when using public `RunResource` subpath
- [ ] `runResourceLayer` exported; named correctly
- [ ] No new circular imports (typecheck)
- [ ] `class RunResourceScope extends State.Scope(RunResource)({ … })` compiles after O1 resolved

---

## Supersedes

- Step 0 `RunResourceIdentity.ts` approach in [telemetry-step0-build-report.md](./telemetry-step0-build-report.md)
- “Domain is not a layered service — type anchor only” in [telemetry-open-decisions-bake.md](../recipes/telemetry-open-decisions-bake.md) — **domain is a real service** with factory shape; user gates remain separate services
