# Telemetry Step 0 + Router — build report

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
| `src/RunResourceIdentity.ts` | **New.** `TypeTag = "@nikscripts/effect-pm/RunResource"`, `TypeId = Symbol.for(TypeTag)` (+ `type TypeId` companion) — **no `Kind`**. Import-free; shared by scope/telemetry/store/projection. |
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

**Reviewed:** 2026-06-08 (owner + bake session). **SSoT:** [telemetry-requirements.md](../recipes/telemetry-requirements.md), [telemetry-open-decisions-bake.md](../recipes/telemetry-open-decisions-bake.md).

### Fix required — `RunResourceIdentity`

**Remove `Kind`.** The identity module exports **`TypeTag` + `TypeId` only** — no separate `Kind`, no raw `"RunResource"` string at author sites.

```ts
// src/RunResourceIdentity.ts — correct shape
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

If identity and the telemetry tree class share a file, prefer `import { TypeTag as RunResourceTypeTag }` to avoid clashing with the API 1 `RunResourceTag` class name.

**Do not** reintroduce `Kind` as a workaround for wire ids — derive the PascalCase wire segment from `TypeTag` inside helpers/factories (today's `telemetryWireId` expects `"RunResource"`, not the full `TypeTag` string).

### Accepted — `TelemetryRouter` alias (interim)

The alias module (`export { TelemetryHub as TelemetryRouter }`) is **OK for the legacy window** given deterministic-keys. New telemetry code imports from `@nikscripts/effect-pm/TelemetryRouter`. Physical class/file/id rename stays **final cleanup** after all importers leave `TelemetryHub`. Record this in requirements change log when you touch docs.

### Step 0 still open (requirements checklist)

This report covers identity + router subpaths only. Still outstanding for Step 0 (or call out explicit deferral):

- `./Telemetry` export (stub ok until Step 1)
- `store/RunResourceTelemetry` / optional `store/RunResourceTag` subpaths
- Wire `RunResourceScope` to `TypeTag` (after identity fix)
- Plan 21 / vocabulary cross-links if not already on branch

### Build gate

Pre-existing `logTransportWebSocket.ts` DTS failure — owner has **not** blocked telemetry on it yet. Keep using `typecheck` + `test` + `lint` as the effective gate until that file is fixed or policy changes.

### Proceed to Step 1 when

1. `RunResourceIdentity` matches shape above (no `Kind`).
2. `RunResourceScope` uses aliased `TypeTag` for both `State.Scope` args.
3. You have a plan for wire namespace derivation from `TypeTag` (factory/internal — not a second exported constant).

---

## Corrections applied (response to owner review) — 2026-06-08

| Item | Status |
| --- | --- |
| Remove `Kind` from `RunResourceIdentity` | ✅ Exports `TypeTag` + `TypeId` only (`type TypeId` companion kept; no `Kind`, no `"RunResource"` literal). |
| `RunResourceScope` → aliased `TypeTag` | ✅ `import { TypeTag as RunResourceTypeTag } from "./RunResourceIdentity"` → `State.Scope(RunResourceTypeTag, { resourceId })(RunResourceTypeTag)`. Scope `kind` + `Context` id are now the `TypeTag` string. (`RunResourceTag` reserved for the API 1 telemetry tree class per owner follow-up.) |
| `TelemetryRouter` alias direction | ✅ Accepted as interim per review. |
| Effective gate after corrections | ✅ `typecheck` + `test` (392/392) + `lint` green. `build` still pre-existing red (`logTransportWebSocket.ts`). |

**Wire namespace derivation plan (review item 3):** the PascalCase wire segment (`"RunResource"`) is derived as the substring after the final `/` of `TypeTag` (`"@nikscripts/effect-pm/RunResource"`) **inside the Tag factory / `telemetryWireId` helper** — not re-exported as a constant. `telemetryWireId` keeps its current `(namespace, tagPath, event)` signature; the factory passes the derived `"RunResource"` segment as `namespace`.

**Deferred Step 0 export subpaths** (`./Telemetry`, `store/RunResourceTelemetry`, optional `store/RunResourceTag`): **explicitly deferred** to Steps 1–3 when their source files exist — adding exports pointing at non-existent `dist/` artifacts would ship broken subpaths. No consumer references them yet.

**Note — `RunScope` leaf id unchanged:** `RunResourceScope.withLeaf("Run", …)("@nikscripts/effect-pm/run/RunScope")` still uses the older `/run/` path. Not directed by the review; flagged for consistency follow-up.

**Recovery note:** a `git stash -u` during the build verification (HEAD comparison) plus an overlapping owner edit pass left the tree partially reset; Step 0 files were recovered surgically from the stash (`RunResourceIdentity.ts` from `^3`, `package.json`/`tsup.config.ts` from the stash tree) and the stash dropped. No work lost.

---

## Follow-up instructions — owner verification 2026-06-08

**Status:** Step 0 identity + router corrections **verified in tree**. You may proceed to **Step 1** (`Telemetry.Tag` factory).

### Doc hygiene (do first)

1. **Fix stale "What landed" table** (§ above) — line 43 still says `Kind = "RunResource"`. Update to match shipped code: `TypeTag` + `TypeId` only; note `RunResourceScope` wired to aliased `TypeTag`.

### Step 1 — implement now

1. **`src/Telemetry.ts`** — Tag factory skeleton per [telemetry-requirements.md § Step 1](../recipes/telemetry-requirements.md).
2. **Wire namespace from `TypeTag`** — implement derivation inside factory/helper (final `/` segment of `TypeTag` → `"RunResource"` passed to `telemetryWireId`). **Do not** add a `Kind` export or author-facing `"RunResource"` constant.
3. **Identity import pattern** — `import { TypeTag as RunResourceTypeTag } from "@nikscripts/effect-pm/RunResourceIdentity"` at Tag/scope call sites; reserve **`RunResourceTag`** as the telemetry tree **class** name (API 1).
4. **`./Telemetry` export** — add `package.json` + `tsup.config.ts` entry when `src/Telemetry.ts` exists and builds.
5. **New code** — import **`TelemetryRouter`** from `@nikscripts/effect-pm/TelemetryRouter`; do not add new `TelemetryHub` imports.

### Step 2 — after Step 1 gate

1. **`RunResourceTag`** port from golden branch (schemas + tree; no wiring on Tag).
2. Add **`store/RunResourceTag`** / **`store/RunResourceTelemetry`** subpaths when those modules exist.

### Follow-up (not blocking Step 1)

| Item | When |
| --- | --- |
| `RunScope` leaf id `"@nikscripts/effect-pm/run/RunScope"` vs `TypeTag`-based naming | Consistency pass — align with owner before bulk scope migration |
| `store/RunResourceTelemetry.ts` raw `"RunResource"` wire literals | Replace when Tag factory lands or wire helper accepts `TypeTag` |
| `TelemetryHub` → physical class/id rename | Final cleanup after all importers use `TelemetryRouter` |
| `logTransportWebSocket.ts` build DTS failure | Separate track — owner has not blocked telemetry on `build` yet |
| Requirements change log | Append router alias interim + identity `TypeTag`-only decision when you next edit requirements |

### Gate (unchanged)

```text
pnpm run typecheck && pnpm test && pnpm run lint
```

Run **`pnpm run build`** for telemetry-touched files when feasible; full-package `build` may remain red until `logTransportWebSocket.ts` is migrated.

### Do not regress

- **No `Kind` export** on `RunResourceIdentity`.
- **No raw `"RunResource"`** at new author sites — derive from `TypeTag` or use aliased import.
- **No `Telemetry.Service` / handle-keyed wiring objects** — see handoff rejected list.
