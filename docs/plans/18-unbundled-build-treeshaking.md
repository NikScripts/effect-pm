# 18 — Unbundled build for guaranteed namespace tree-shaking

**Status: IMPORTANT TODO (not blocking).** Future work — see `docs/plans/README.md` policy.

## The goal

Make `import { QueueResource } from "@nikscripts/effect-pm"` + `QueueResource.Tag` (the **barrel
namespace** access) tree-shake the engine in **every** bundler — the full Effect treatment, where
`Effect.map` pulls only `map`, not all of `Effect`.

## What's already done (works today)

The source is already structured the Effect way (commit `6741eddbd`):

- `internal/queueSchema.ts` — the shared wire/error schemas, `effect`-only; the engine imports +
  re-exports them so the contract's `Tag`/spec is **engine-free**.
- `QueueContract.ts` — the light contract: `Tag` / spec / schemas / `configure` as named exports.
- `internal/queueResourceNamespace.ts` + barrel `export * as QueueResource` — one namespace from
  per-member named exports.
- `tsup splitting: true` — the engine is a shared **chunk**, not inlined into every entry.

**Proven (esbuild):** `import { queueTag } from "@nikscripts/effect-pm/QueueContract"` bundles to
**23kb with zero engine symbols** (was 352kb). The **subpath is the guaranteed engine-free path.**

## The remaining gap

The **barrel** `QueueResource` is materialized by tsup into a runtime object
(`queueResourceNamespace_exports`) when it bundles the index entry. Property access on a runtime
object can't be tree-shaken by esbuild (Vite **dev**). Rollup (Vite/Next **prod**) is better at
namespace-member analysis and *may* drop it, but it's not guaranteed.

To make it guaranteed everywhere, the package must ship **unbundled / preserve-modules** ESM —
exactly how Effect ships (per-module `.js` files, `export * as X from "./X.js"` preserved, not
flattened). Then the consumer's bundler resolves `QueueResource.Tag` to the real module export and
drops the rest.

## The work (package-wide build change)

1. Replace tsup's bundling for the library entries with a **preserve-modules** build (Rollup
   `output.preserveModules: true`, or `tsc`-emitted ESM, keeping tsup only for `.d.ts` if useful).
2. Keep `"sideEffects": false`.
3. Verify with the bundle check below that the **barrel** `QueueResource.Tag` excludes engine
   symbols (`makeQueueRuntime`, `QueueResourceStore`) under both esbuild and Rollup.
4. Apply the same to `ProcessResource` / `ProcessScheduleResource` namespaces.

## Sibling item: light-split parity for Process / Schedule (smaller, not blocking)

Only the **queue** got the full light-split. `ProcessResource` / `ProcessScheduleResource` are still
`const … = { Tag, layer, … }` **objects** that import their engine, so importing their tags pulls
the (pure-Effect) Process/Schedule engine — **browser-safe, just ~85kb larger**, verified no native
deps. To make their tags tree-shake like the queue's:

- their schemas are already light (in the contract), so **no schema move needed** — just convert
  each to per-member named exports + an `internal/*Namespace.ts` + barrel `export * as`.

Until then, the dashboard works but carries the process/schedule engine code. Do this for bundle
parity when convenient; it does not block the launch.

## Why it's not urgent (the wow-sports check)

- effect-pm is consumed **server-side** today (`apps/services-hub`, Node) — bundle size is moot.
- The dashboard (`apps/web`, Next) will import tags into the **browser**, but the queue engine has
  **zero native/node deps** (verified) — so a non-tree-shaken bundle is **larger, never broken**.
- The `/QueueContract` subpath already gives the dashboard guaranteed-light tags today.

So this is a **size/polish** optimization. Do it before any consumer demonstrably needs a smaller
browser bundle, or as general release hardening — not as a blocker.

## Guard / proof

```sh
# bundle a Tag-only entry and assert zero engine symbols
esbuild entry.ts --bundle --packages=external --format=esm | grep -c makeQueueRuntime  # want 0
```
Consider adding this as a CI check once the unbundled build lands.
