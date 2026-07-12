{#modules-and-boundaries title="Modules & boundaries" order=20 appliesTo=src}
# Modules & boundaries

How the code is split into modules, what each one exposes, and how the public and browser-safe boundary is kept. Covers module layout, the public/internal line, and build & tree-shaking.

{#one-file-flat-exports .must appliesTo=src}
## A public module is one file with flat exports

One public module = one file in a role folder (usually `src/`), consumed as `import * as Name`.
Members are flat top-level `export const` / `function` / `type` — never grouped under an object.

``` ts
// consumer
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
QueueResource.Tag        // pulls zero engine code
QueueResource.serve      // pulls the engine only when used
```

{#filename-matches-export .must appliesTo=src}
## The filename matches what it exports

The filename **is** the name of its primary export. Usually that's a PascalCase namespace
(`QueueResource.ts`), but it's camelCase when the module's export is a value — a layer, an effect, a
helper (Effect's `internal/cache.ts`). No orphan files that export nothing of that name.

**Banned:** `*Contract`, `*Namespace`, and object-engine files — a monorepo-wide search of Effect
finds zero `*Contract` files. Name by role/noun, like Effect's `RpcServer` / `RpcClient` /
`RpcGroup`.

``` ts
// ❌ bad — orphan name; exports nothing called QueueContract
// src/QueueContract.ts

// ✅ good — named for its export
// src/QueueResource.ts   (exports the QueueResource namespace)
```

{#no-object-namespace .must appliesTo=src}
## Never an object-as-namespace for the public surface

Effect has no `export const Effect = { … }`; `Effect.ts` is flat `export const succeed`, etc. Match
it — an object engine defeats member-level tree-shaking.

``` ts
// ❌ bad — object-as-namespace
export const QueueResource = { Tag, make, layer, serve }

// ✅ good — flat exports, re-exported once from the barrel (src/index.ts)
export * as QueueResource from "./QueueResource"
```

{#types-same-file .must appliesTo=src}
## Associated types attach in the same file

Type-level helpers live beside their value via `export declare namespace Name { … }` — as Effect
does in `HashMap.ts` — not a separate `*Types.ts`. The `declare namespace` merges with the value
namespace and the primary type under one name, so a module is a value, a type, and a home for member
types at once.

``` ts
// src/Resource.ts
export const client = /* … */
export declare namespace Resource {
  export type ServiceOf<S> = /* … */
}
```

{#headline-type-named-after-module .must appliesTo=src}
## A data-type module names its type after the module

When a module *is* a single data type, the type takes the module's own name, so it reads
`Module.Module<…>` — `Effect.Effect<A, E, R>`, `Option.Option<A>`, `HashMap.HashMap<K, V>`. The
value namespace (the module's functions) and the type merge under that one name; consumers import
`* as Module` and reach both.

{#thin-shell-over-internal .must appliesTo=src}
## Heavy implementation lives in an internal module with a matching name

The public `Foo.ts` is a thin re-export shell over an internal implementation whose filename mirrors
it (Effect: `Cache.ts` ↔ `internal/cache.ts`). Internal modules are camelCase, get **no subpath**,
and are **never imported by apps**.

``` ts
// src/QueueResource.ts (public shell)
import { makeQueueEffect } from "./internal/queueResource"   // engine implementation
```

{#subpaths-never-internal .must appliesTo=src}
## Subpaths never resolve into internal/

`@nikscripts/effect-pm/Name` resolves to the public `src/Name.ts`, surfaced via the barrel
`export * as Name from "./Name"` — one line per module. It must **not** resolve to `src/internal/*`.


{#public-is-app-imported .must appliesTo=src}
## Public is what apps import; internal is package-only

**Public** = a symbol an app imports, via `@nikscripts/effect-pm`, a documented subpath, or a bin
entry. **Internal** (`src/internal/`) = package-only wiring: never exported from the barrel, no
subpath, never imported by an app.

``` ts
// ✅ public
import * as Process from "@nikscripts/effect-pm/Process"

// ❌ internal — apps must never reach here
import { makeQueueEffect } from "@nikscripts/effect-pm/internal/queueResource"
```

{#never-split-namespace .must appliesTo=src}
## Never split a namespace to escape file size

Size is not a reason to fan one namespace across public files. A namespace is always one public
file, however large — the growth goes to `internal/` (heavy implementation, per *Module layout*) or to a
separate concern (below), never to a second public file for the same namespace.

{.note}
A 15,000-line module is fine: Effect's `Effect.ts` and `Schema.ts` are each ~15k lines in a single
file.

{#concern-becomes-sibling .must appliesTo=src}
## A distinct concern becomes its own sibling namespace

When a separable concern grows, split it into a **sibling module named by a shared prefix** — its
own file, namespace, and import — not sub-sections of a mega-namespace.

{.note}
`Schema` sits beside `SchemaAST`, `SchemaParser`, `SchemaIssue`, `SchemaGetter`,
`SchemaTransformation`, `SchemaRepresentation`; `Rpc` beside `RpcClient`, `RpcServer`, `RpcGroup`,
`RpcSchema`. Related by name, independent as modules.

{#domain-family-subdir .must appliesTo=src}
## A domain family is a subdirectory with its own barrel and internal/

A group of related modules that ship as one import surface lives in a **subdirectory that is a
single subpath**, with its **own `index.ts` barrel and its own `internal/`**.

{.note}
`unstable/rpc/` = `Rpc.ts` + `RpcClient.ts` + `RpcServer.ts` + … + `index.ts` + `internal/`,
exported as the one subpath `unstable/rpc`. Each domain — `rpc`, `sql`, `http`, `persistence`,
`eventlog` — is a self-contained folder.

{#substrate-vs-consumer .must appliesTo=src}
## Substrate gets its own home; consumer-specific wiring stays with the consumer

The placement test. Reusable substrate used by several engines gets its own module or family; wiring
specific to one consumer stays in *that* consumer's module or its `internal/`.

{.note}
Persistence primitives shared across engines stand alone (as the `persistence` and `eventlog`
domains do); an engine's private wiring lives in its own `internal/`.

This decides where persistence code lives: the shared, type-agnostic spine is substrate (its own
home, today `src/internal/store/`); a facet only one resource uses co-locates with that resource.
Group facets under a `store/` family only when they're a reusable surface in their own right.


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
