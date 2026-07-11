{#module-layout title="Module layout" order=20 appliesTo=src}
# Module layout

The module is the file is the namespace. `.cursor`-enforced (`alwaysApply`). The examples below cite
Effect's own modules, which follow these same rules.

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
