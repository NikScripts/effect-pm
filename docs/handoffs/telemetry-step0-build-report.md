# Telemetry Step 0 + Router — build report

> **Superseded (Jun 2026):** **`RunResourceIdentity.ts`** and **`TypeTag`** scope wiring are **withdrawn**.
> Domain identity → **`RunResource`** `Context.Service` ([run-resource-service-handoff.md](./run-resource-service-handoff.md)).
> Facet Tag → **`Telemetry.Tag<Self>(RunResource)(facetId, Telemetry.namespace(...), tree)`** ([telemetry-requirements.md](../recipes/telemetry-requirements.md)).
> This report remains **historical** for Step 0 router alias work only.

**Branch:** `cursor/telemetry-redesign-bake-faed`
**Date:** 2026-06-08
**Scope:** Step 0 (package surface + identity) and the `TelemetryHub → TelemetryRouter` legacy alias.
**Gate:** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`

---

## Gate results

| Check | Result | Notes |
| --- | --- | --- |
| `typecheck` | ✅ pass | Both projects: `tsconfig.json` + `tsconfig.src.strict-effect-provide.json` |
| `test` | ✅ pass | `vitest run` — **54 files, 392 tests passed** (~6.8s) |
| `lint` | ✅ pass | 0 errors. 1 **pre-existing** warning (unused eslint-disable) in `test/queue-resource-store-facet.test.ts` — not touched by this work |
| `build` | ⚠️ pre-existing failure | JS bundle succeeds; **DTS type-emit fails on a file unrelated to telemetry** (see below). New telemetry files pass the DTS pass cleanly. |

### Build failure detail (pre-existing — not caused by this work)

`pnpm run build` (tsup) fails in the **DTS** stage via the Effect language-service plugin:

```
src/react/logTransportWebSocket.ts(139,1): error TS69: async function — prefer Effect.gen
src/react/logTransportWebSocket.ts(170,16): error TS69: async function — prefer Effect.gen
src/react/logTransportWebSocket.ts(172,13): error TS68: new Promise(...) — prefer Effect.async/promise/tryPromise
src/react/logTransportWebSocket.ts(188,9): error TS68: new Promise(...) — prefer Effect APIs
DTS Build error
```

**Verification it is pre-existing:** stashing all Step 0 changes (`git stash -u`) and building clean `HEAD` reproduces the identical four errors. The JS build (`ESM`/`CJS`) reports `Build success` in both cases. The break is in `src/react/logTransportWebSocket.ts` (log-transport React adapter), which this work does not modify.

**Effective gate for telemetry work:** `typecheck` + `test` + `lint` green, and JS build + DTS pass clean for all telemetry-touched files. The `build` red is an out-of-scope, pre-existing condition pending a separate decision (fix the react file vs. accept).

A second, transient `ERR_WORKER_OUT_OF_MEMORY` from the DTS worker was seen once and cleared on retry with `NODE_OPTIONS=--max-old-space-size=8192`; not a code issue.

---

## What landed

| File | Change |
| --- | --- |
| `src/RunResourceIdentity.ts` | **New (Step 0 — superseded).** To be **deleted on R4**; replaced by **`RunResource`** domain service + **`Tags.ts`**. |
| `src/RunResourceScope.ts` | Wired to aliased `TypeTag` — `State.Scope(RunResourceTypeTag, { resourceId })(RunResourceTypeTag)`. |
| `src/TelemetryRouter.ts` | **New.** Canonical-name alias: `export * from "./TelemetryHub"` + `export { TelemetryHub as TelemetryRouter }`. Same class, same `Context` id `@nikscripts/effect-pm/TelemetryHub` → one shared instance. New telemetry code imports `TelemetryRouter` from here. |
| `tsup.config.ts` | Added entries `RunResourceIdentity`, `TelemetryRouter`. `TelemetryHub` kept (legacy). |
| `package.json` | Added exports `./RunResourceIdentity`, `./TelemetryRouter`. `./TelemetryHub` kept (legacy). |

`src/TelemetryHub.ts` and `src/internal/telemetryHub/*` are **unchanged** from `HEAD`.

---

## Decision recorded — Router rename direction

Owner chose **A** (keep the existing `Context` id during the legacy window so `TelemetryHub` and `TelemetryRouter` resolve to one shared instance).

**Constraint hit:** the Effect language-service **deterministic-keys** rule couples a `Context.Service` class name to its id string — a class named `TelemetryRouter` is required to use id `@nikscripts/effect-pm/TelemetryRouter`. Renaming the class while keeping the `…/TelemetryHub` id fails the DTS build (`error TS25`).

**Resolution (honors A, no lint suppression):** keep the canonical class as `TelemetryHub` (id unchanged → rule satisfied); expose `TelemetryRouter` as an alias module. Functionally equivalent to the request — both names, one instance, `TelemetryHub` migrates out later. The physical class/file/id rename is deferred to final cleanup (it changes the `Context` id, so it waits until all importers move off `TelemetryHub`).

**Open alternative:** force class `TelemetryRouter` now via a per-declaration deterministic-keys suppression — not taken; awaiting owner preference.

---

## Open items

1. **`build` gate** — fix `src/react/logTransportWebSocket.ts` (`async`/`new Promise` → Effect) separately, or accept JS-build + typecheck as the effective gate. Owner decision pending.
2. **Router** — accept the alias-direction resolution above, or switch to a lint suppression for an immediate class rename.
3. **Next:** Step 1 `Telemetry.Tag` factory → Step 2 RunResource port → stop at gate with the Step 3 decision set.

---

## Owner review — read before continuing

> **Superseded (Jun 2026):** Identity / `TypeTag` / wire-from-tag instructions in this section
> are **withdrawn**. Use [run-resource-service-handoff.md](./run-resource-service-handoff.md) +
> [telemetry-requirements.md](../recipes/telemetry-requirements.md).

<details>
<summary>Historical owner review (Step 0 identity — do not implement)</summary>

**Reviewed:** 2026-06-08 (owner + bake session). **SSoT:** [telemetry-requirements.md](../recipes/telemetry-requirements.md), [telemetry-open-decisions-bake.md](../recipes/telemetry-open-decisions-bake.md).

### Fix required — `RunResourceIdentity` (withdrawn)

**Remove `Kind`.** The identity module exports **`TypeTag` + `TypeId` only** — no separate `Kind`, no raw `"RunResource"` string at author sites.

```ts
// src/RunResourceIdentity.ts — Step 0 shape (to be deleted on R4)
export const TypeTag = "@nikscripts/effect-pm/RunResource";
export const TypeId: unique symbol = Symbol.for(TypeTag);
```

Use sites import with a local alias:

```ts
import { TypeTag as RunResourceTag } from "@nikscripts/effect-pm/RunResourceIdentity";

export const RunResourceScope = State.Scope(RunResourceTag, {
  resourceId: Schema.String,
})(RunResourceTag);
```

**Do not** reintroduce `Kind` as a workaround for wire ids — **superseded:** wires come from **`Telemetry.namespace("RunResource")`**, not from `TypeTag`.

### Accepted — `TelemetryRouter` alias (interim)

The alias module (`export { TelemetryHub as TelemetryRouter }`) is **OK for the legacy window** given deterministic-keys. New telemetry code imports from `@nikscripts/effect-pm/TelemetryRouter`. Physical class/file/id rename stays **final cleanup** after all importers leave `TelemetryHub`.

### Step 0 still open (requirements checklist) — historical

- `./Telemetry` export (stub ok until Step 1)
- `store/RunResourceTelemetry` subpaths
- Wire `RunResourceScope` to domain **`RunResource`** service (not `TypeTag`)
- Plan 21 / vocabulary cross-links

### Build gate

Pre-existing `logTransportWebSocket.ts` DTS failure — owner has **not** blocked telemetry on it yet. Keep using `typecheck` + `test` + `lint` as the effective gate until that file is fixed or policy changes.

### Proceed to Step 1 when (historical)

1. ~~`RunResourceIdentity` matches shape above~~ → **RunResource service R1–R4** instead.
2. ~~`RunResourceScope` uses `TypeTag`~~ → **`State.Scope(RunResource)(fields)`** class (O1).
3. ~~Wire namespace from `TypeTag`~~ → **`Telemetry.namespace("RunResource")`**.

</details>

---

## Corrections applied (response to owner review) — 2026-06-08

> **Historical record** — Step 0 identity work; superseded by RunResource service migration.

<details>
<summary>Historical corrections table</summary>

| Item | Status |
| --- | --- |
| Remove `Kind` from `RunResourceIdentity` | ✅ Exports `TypeTag` + `TypeId` only (`type TypeId` companion kept; no `Kind`, no `"RunResource"` literal). |
| `RunResourceScope` → aliased `TypeTag` | ✅ `import { TypeTag as RunResourceTypeTag } from "./RunResourceIdentity"` → `State.Scope(RunResourceTypeTag, { resourceId })(RunResourceTypeTag)`. Scope `kind` + `Context` id are now the `TypeTag` string. (`RunResourceTag` reserved for the API 1 telemetry tree class per owner follow-up.) |
| `TelemetryRouter` alias direction | ✅ Accepted as interim per review. |
| Effective gate after corrections | ✅ `typecheck` + `test` (392/392) + `lint` green. `build` still pre-existing red (`logTransportWebSocket.ts`). |

**Wire namespace derivation plan (review item 3) — withdrawn:** wires come from **`Telemetry.namespace("RunResource")`** on the Tag — not from `TypeTag` / `split("/")`.

**Deferred Step 0 export subpaths** (`./Telemetry`, `store/RunResourceTelemetry`): **explicitly deferred** to Steps 1–3 when their source files exist — adding exports pointing at non-existent `dist/` artifacts would ship broken subpaths. No consumer references them yet.

**Note — `RunScope` leaf id unchanged:** `RunResourceScope.withLeaf("Run", …)("@nikscripts/effect-pm/run/RunScope")` still uses the older `/run/` path. Not directed by the review; flagged for consistency follow-up.

**Recovery note:** a `git stash -u` during the build verification (HEAD comparison) plus an overlapping owner edit pass left the tree partially reset; Step 0 files were recovered surgically from the stash (`RunResourceIdentity.ts` from `^3`, `package.json`/`tsup.config.ts` from the stash tree) and the stash dropped. No work lost.

</details>

---

## Follow-up instructions — owner verification 2026-06-08

> **Superseded:** Identity / `RunResourceTag` / wire-from-`TypeTag` instructions below. Use [run-resource-service-handoff.md](./run-resource-service-handoff.md) + [telemetry-requirements.md](../recipes/telemetry-requirements.md) (**`Telemetry.Tag(Self)(RunResource)(facetId, …)`**).

**Status (historical):** Step 0 router alias verified. **Next:** RunResource service R1–R4, then Step 1 Tag factory per requirements § Step 1.

### Gate (unchanged)

```text
pnpm run typecheck && pnpm test && pnpm run lint
```

Run **`pnpm run build`** for telemetry-touched files when feasible; full-package `build` may remain red until `logTransportWebSocket.ts` is migrated.

### Do not regress

- **No `Telemetry.Service(Tag, wiringObject)`** — use **`Wiring.sections`** + **`Telemetry.layer`** + **`Telemetry.withLayer`**.
- **No `RunResourceTag`** facet name — **`RunResourceTelemetry`**.
- **No wire derivation from domain tag** — use **`Telemetry.namespace`** only.
