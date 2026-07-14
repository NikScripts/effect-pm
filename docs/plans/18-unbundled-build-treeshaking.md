# Unbundled build for guaranteed namespace tree-shaking

**Status: IMPORTANT TODO (not blocking).** Future work — see [README.md](./README.md).

## The goal

Make `import { QueueResource } from "@nikscripts/effect-pm"` + `QueueResource.Tag` (the **barrel
namespace** access) tree-shake the engine in **every** bundler — the full Effect treatment, where
`Effect.map` pulls only `map`, not all of `Effect`.

## What's already done (works today)

Public modules match Effect’s flat namespace layout (`src/QueueResource.ts` ↔
`src/internal/queueResource.ts`, etc.):

- Light wire/tag schemas live in small internal modules (`internal/queueTagSchemas.ts`, …) so the
  **Tag / spec** path stays engine-free.
- The public file is a flat namespace of named exports; the barrel does
  `export * as QueueResource from "./QueueResource"`.
- Subpath imports (e.g. `@nikscripts/effect-pm/QueueResource`) are **proven engine-free** for Tag-only
  pulls. Prefer `import * as QueueResource from "@nikscripts/effect-pm/QueueResource"` in browser bundles.

**Proven (esbuild):** Tag-only subpath pulls stay small with **zero engine symbols**. The **subpath is
the guaranteed engine-free path.**

## The remaining gap

The **barrel** `QueueResource` is still easy for tsup/bundlers to materialize as a runtime object when
bundling the package index. Property access on a runtime object can’t be tree-shaken by esbuild
(Vite **dev**). Rollup (Vite/Next **prod**) is better at namespace-member analysis and *may* drop it,
but it’s not guaranteed.

To make it guaranteed everywhere, the package must ship **unbundled / preserve-modules** ESM —
exactly how Effect ships (per-module `.js` files, `export * as X from "./X.js"` preserved, not
flattened). Then the consumer’s bundler resolves `QueueResource.Tag` to the real module export and
drops the rest.

## The work (package-wide build change)

1. Replace tsup’s bundling for the library entries with a **preserve-modules** build (Rollup
   `output.preserveModules: true`, or `tsc`-emitted ESM, keeping tsup only for `.d.ts` if useful).
2. Keep `"sideEffects": false`.
3. Verify with the bundle check below that the **barrel** `QueueResource.Tag` excludes engine
   symbols under both esbuild and Rollup.
4. Apply the same proof to `Process` (and any other heavy barrel namespaces).

## Why it’s not urgent

- Most consumers are **server-side** today — bundle size is moot.
- Dashboard / browser imports should use **subpath** `import * as …` (already engine-free).
- A non-tree-shaken barrel is **larger, never broken** (queue engine has no native Node deps on the
  Tag path).

So this is a **size/polish** optimization — do it before a consumer demonstrably needs a smaller
browser barrel, or as release hardening.

## Guard / proof

```sh
# bundle a Tag-only entry and assert zero engine symbols
esbuild entry.ts --bundle --packages=external --format=esm | grep -c makeQueueRuntime  # want 0
```

Consider adding this as a CI check once the unbundled build lands.
