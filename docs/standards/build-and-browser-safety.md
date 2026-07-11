{#build-and-browser-safety title="Build & browser safety" order=130 appliesTo=src}
# Build & browser safety

A tag is a light value a browser can import; the engine behind it is node-only. Browser safety is not
about *where* code lives — it's about whether a bundler can **tree-shake** the engine out of a build
that only imports the tag. These rules keep that possible.

{#side-effect-free-esm .must appliesTo=src}
## `sideEffects: false` + ESM is the foundation

Tree-shaking is what makes the package browser-safe, and it only works when the package promises the
bundler there's nothing to run at import time. ESM modules, `"sideEffects": false`, and every optional
peer (react, recharts, ink, sqlite, redis) externalized.

``` jsonc
// package.json
{
  "type": "module",
  "sideEffects": false
}
```

{#no-top-level-side-effects .must appliesTo=src}
## No top-level side effects

This is the real leak. A bundler can drop an unused `export`, but it can **not** drop code that runs
at module load — and that code drags its imports (the engine, `node:*`, `better-sqlite3`) into every
bundle. Do work inside functions, never at module scope.

``` ts
// ❌ bad — runs at import; can't be shaken out, so the engine ships to the browser
import { registerWorker } from "./internal/engine"
registerWorker(Mail)

// ✅ good — the engine is reached only when a function is called, which a browser never does
export const start = () => registerWorker(Mail)
```

{#node-only-imports-stay-node .must appliesTo=src}
## Node-only modules are imported only from node-only code

A module a browser can reach must never import a node-only one — `storage/sqlite`, `storage/redis`,
the HTTP server layers. Those pull `node:*` and native deps that have no place in a browser graph.

``` ts
// ❌ bad — a browser-reachable module importing a node backend
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite"

// ✅ good — that import lives in the server entry, which the browser bundle never touches
```

{#export-each-symbol-once .must appliesTo=src}
## Export each symbol exactly once

A symbol exported from two places (a re-export *and* a local `export const` of the same name) sends
the type-checker into a multi-minute loop. One export site per symbol.

``` ts
// ❌ bad — makeQueue exported twice
export { makeQueue } from "./internal/queue"
export const makeQueue = /* … */

// ✅ good — one home for the export
export { makeQueue } from "./internal/queue"
```

{#prefer-subpaths .should appliesTo=src}
## Prefer specific subpaths over the barrel in browser code

The root barrel is browser-safe, but it reaches the whole toolkit. In a browser bundle, import the
one tag subpath you need — a smaller graph and a clearer boundary.

``` ts
// ✅ better in a widget — just the tag
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
```

{#separate-contract-and-impl .should appliesTo=src}
## Keep contract and implementation separate — as a safeguard

Tree-shaking handles a module that exports both a tag and its layer, so this is not required. But
keeping the tag in its own module makes the node boundary obvious and guards against an accidental
top-level engine side effect slipping in beside the tag. A cheap safeguard, not a hard rule.

{#verify-the-bundle .should appliesTo=src}
## Verify by grepping the built bundle

Don't assume — check. Build, then grep the client bundle for node markers; if any show up, trace the
import chain back to the module that pulled them.

``` sh
pnpm build && grep -rqE 'node:|better-sqlite3' dist/web/ && echo "LEAK — trace the import" || echo "clean"
```
