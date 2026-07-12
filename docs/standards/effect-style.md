{#effect-style title="Effect Style" order=40 appliesTo=src}
# Effect Style

How Effect code reads day to day — the platform surface and idioms, plus formatting and comments.

{#native-effect-subpaths .must appliesTo=src}
## Reach for native Effect subpaths, not external packages

Reactivity, RPC, SQL, HTTP, event logs, persistence — all ship inside Effect under
`effect/unstable/*`. Import them from there; never pull an external package that duplicates them (no
`@effect-atom` — reactivity is `effect/unstable/reactivity`).

``` ts
// ✅ good — native
import * as Reactivity from "effect/unstable/reactivity"
import { RpcServer } from "effect/unstable/rpc"
import { SqlClient } from "effect/unstable/sql/SqlClient"

// ❌ bad — an external package that Effect already provides
import { Atom } from "@effect-atom/atom"
```

{#know-the-surface .should appliesTo=src}
## Know the surface before reaching outside it

Effect is large — most of what you'd pull a dependency for already ships. Scan here before adding
one.

Core (`effect`):

- **Runtime & structure** — `Effect`, `Layer`, `Context`, `Runtime`, `ManagedRuntime`, `Scope`,
  `Resource`
- **State & concurrency** — `Ref`, `SubscriptionRef`, `Deferred`, `Queue`, `PubSub`, `Fiber`
  (`FiberHandle` / `FiberMap` / `FiberSet`), `Pool`
- **Data & errors** — `Data`, `Cause`, `Exit`, `Option`, `Result`, `Match`, `Predicate`, `Schema`
  (`SchemaAST`, `SchemaIssue`, …)
- **Time & scheduling** — `Clock`, `Duration`, `DateTime`, `Schedule`, `Cron`
- **Streaming** — `Stream`, `Channel`
- **Config & observability** — `Config`, `ConfigProvider`, `Metric`, `Logger`, `Tracer`
- **Platform** — `FileSystem`, `Path`, `PlatformError`, `Crypto`

Families (`effect/unstable/*`), each a self-contained subpath (see *Public vs internal → domain
family*): `rpc`, `sql`, `http`, `httpapi`, `cli`, `reactivity`, `persistence`, `eventlog`,
`encoding`, `socket`, `workers`, `workflow`, `cluster`, `observability`, `ai`.

{.note}
**Where to look.** The authoritative source for the version we run is `node_modules/effect/src/<Module>.ts`;
the vendored `repos/effect/packages/effect/src` mirrors it for browsing. Open the real module before
guessing an API (next rule).

{#payload-accepts-any-schema .must appliesTo=src}
## A payload slot accepts any `Schema.Top`, not only loose fields

Payload, input, and wire slots are typed `Schema.Top`, so they take a *single schema value* of any
kind — `Schema.Struct`, `Schema.Class`, `Schema.Array`, a union — and the loose-fields shorthand
(`{ id: Schema.String }`), which is sugar that wraps into a struct and is idiomatic in RPC method
definitions. Both are valid.

The rule is what a payload-accepting API must *accept*: always a full `Schema.Top`, **never only
loose fields**. Loose-only is the trap that bit the queue input — it blocked passing a named schema
or a `Schema.Class`. Accept the full schema and the shorthand falls out for free.

``` ts
// ✅ all valid — the slot is Schema.Top
payload: Schema.Struct({ id: Schema.String })   // a struct
payload: WorkItem                                // a Schema.Class
payload: Schema.Array(itemSchema)                // an array, a union, …
payload: { id: Schema.String }                   // loose-fields shorthand — fine, wraps to a struct

// ❌ bad — an API that accepts ONLY loose fields; a named schema can't be passed
declareQueue(fields: Record<string, Schema.Top>)
```

{#wire-errors-are-schema-errors .must appliesTo=src}
## Errors that cross the wire are schema errors

An in-process failure is a `Data.TaggedError` (see *Principles → Errors are values*). An error that
travels over RPC must also **encode**, so it extends the schema error class
(`Schema.TaggedErrorClass`) — that makes it both a yieldable error and wire-serializable in one
declaration.

``` ts
// ✅ good — wire-encodable: yieldable AND serializable
class QueueMissingItemSchemaError extends Schema.TaggedErrorClass<QueueMissingItemSchemaError>()(
  "QueueMissingItemSchemaError",
  { id: Schema.String },
) {}
```

{#platform-services-not-node .must appliesTo=src}
## Use Effect platform services, not raw `node:*`

Filesystem, path, process, and HTTP work goes through the Effect service — `FileSystem`, `Path`,
`ChildProcess`, `HttpClient` — never a raw `node:*` import. If no service exists for a primitive
(for example Ed25519 crypto), isolate the Node API behind a small Effect-returning helper rather than
scattering raw calls.

``` ts
// ❌ bad — raw node
import { readFile } from "node:fs/promises"
const text = await readFile(path, "utf8")

// ✅ good — the FileSystem service
const fs = yield* FileSystem.FileSystem
const text = yield* fs.readFileString(path)
```

{#read-resolved-effect .must appliesTo=src}
## Read the resolved Effect source before guessing

When you're unsure of an Effect API, open the resolved package (`node_modules/effect/src`, or the
vendored `repos/effect/packages/effect/src`) and copy the real shape — don't guess from memory.
`repos/` is read-only reference: **never import from it, never edit it.** Application and package
code import from the declared `effect` dependency.


{#one-field-per-line .must appliesTo=src}
## One field per line

Never collapse a multi-field object or parameter list onto one line. One field per line, always — a
collapsed literal is unreadable on a narrow screen and buries a bad diff.

``` ts
// ❌ bad — collapsed onto one line
const config = { levelCount: 4, namedLevels: { interactive: 0, batch: 3 }, takeAlgorithm: "weighted" }

// ✅ good — one field per line
const config = {
  levelCount: 4,
  namedLevels: { interactive: 0, batch: 3 },
  takeAlgorithm: "weighted",
}
```

{#comment-non-obvious-plumbing .should appliesTo=src}
## Comment the non-obvious plumbing, not the obvious

Comment where the code relies on something it doesn't show — a type-level trick, an Effect
layer-ordering constraint, runtime ownership, a timing subtlety. Don't narrate what the code already
says.

``` ts
// ✅ good — explains a constraint you can't see in the call
// provideMerge, not provide: a bare provide prunes the serve layers off httpServer
const node = Resource.httpServer([Counter.serve]).pipe(Layer.provideMerge(deps))

// ❌ bad — restates the obvious
const total = a + b // add a and b
```

{#mark-the-surface .should appliesTo=src}
## Mark the surface with `@public` / `@internal` / `@module`

An app-facing symbol carries `@public`; a package-only one carries `@internal`; a large module opens
with a `@module` overview so a reader lands with context.

``` ts
/**
 * The queue worker namespace — Tag, make, layer, serve.
 * @module QueueResource
 */

/** @public */
export const layer = /* … */

/** @internal */
export const makeQueueEffect = /* … */
```
