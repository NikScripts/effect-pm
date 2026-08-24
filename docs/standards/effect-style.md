{#effect-style title="Effect Style" order=40 appliesTo=src}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/effect-style>.
<!-- docs-site-link:end -->
# Effect Style

How Effect code reads day to day — the platform surface and idioms, Layer/`Effect.provide`
hygiene (entry points, nesting, lifetimes), plus formatting and comments.

{#native-effect-subpaths .must appliesTo="src examples"}
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

{#know-the-surface .should appliesTo="src examples"}
## Know the surface before reaching outside it

Effect is large — most of what you'd pull a dependency for already ships. Scan here before adding
one.

Core (`effect`):

- **Runtime & structure** — `Effect`, `Layer`, `Context`, `Runtime`, `ManagedRuntime`, `Scope`,
  `Hyperlink`
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

{#wire-errors-are-schema-errors .must appliesTo="src examples"}
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

{#platform-services-not-node .must appliesTo="src examples"}
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

{#provide-at-entry-points .must appliesTo="src examples"}
## `Effect.provide` with a Layer belongs at the application entry point

Compose the Layer graph with `Layer.provide` / `provideMerge` wherever you build dependencies.
**Close `R` with `Effect.provide(program, layer)` (or `ManagedRuntime` / the app's one bake) only at
an application entry point** — the Effect LSP `strictEffectProvide` rule. Scatter provide through
helpers, workers, Views, or page sections and you break scope lifetimes.

Internals **declare** (`yield* Tag`). The edge **provides**. Same seam as *Hyperlink Services →
Declare dependencies in the worker; provide at the serve boundary*.

``` ts
// ✅ good — compose the graph; provide once at the entry point
const AppLive = pipe(HttpLive, Layer.provide(Db.layer), Layer.provide(Config.layer))
ManagedRuntime.make(AppLive) // or Effect.provide(main, AppLive) at main / server boot

// ❌ bad — mid-program provide of a Layer (strictEffectProvide)
const handler = (req) =>
  program.pipe(Effect.provide(Db.layer)) // new scope / instance per call
```

{#nest-provide-for-scope .must appliesTo="src examples"}
## Nest provide only to open a new requirement or resource scope

Nesting is not free and not constant. Nest `Effect.provide` / a React provider **only when the
inner program has a different `R` or resource lifetime than the outer** — a real dependency
boundary for that subtree (request scope, matched route kit, feature region with its own
resources). Outer keeps its bag; inner gets the nested bag for that region.

Do **not** nest to re-provide the same application Layer, spin a second app runtime per leaf, or
"make a View work" under an already-baked edge. That is scattering provide, not scoping.

`Layer.provide` while **building** a Layer is graph composition — fine anywhere. Nesting
**runtime** provide is the lifetime decision.

{#provide-site-sets-lifetime .must appliesTo="src examples"}
## The provide site owns lifetime and instance identity

Where you provide decides how long layered resources live, when finalizers run, and whether
descendants share **one** instance or get a **new** one per nest.

| Provide site | Lifetime / identity |
|--------------|---------------------|
| Process / server / CLI `main` | Lives for the process |
| Web **page root** (document / app shell provider) | Lives for the page |
| Route / group / feature subtree | Opens and tears down with that match / region |

Wrong place → duplicate runtimes, leaked or prematurely killed resources, or children missing
services. Compose the graph anywhere; pick the provide site on purpose.

{#web-page-entry-point .must appliesTo="src examples"}
## On a web page, the entry point is the page root

For a page, the application entry point is the **document / app shell bake** — one provider around
the tree (e.g. `Last.provider(layer)`). Provide the Layer **there**. Everything under that root
**declares** and renders (`yield*`, `Last.use`, …). It does not provide the app Layer again per
View, per link, or per section.

Nested providers on a page are only for a **new scope bag** under that one bake (active router
context, a region with different requirements) — same rule as *Nest provide only to open a new
requirement or resource scope*. They are not a second entry point.

{#no-nested-yield .must appliesTo="src examples test"}
## Never nest a `yield*` inside another expression

A `yield*` stands on its own — bind its result to a `const`, then use it. Never tuck a `yield*` into
another call's arguments or an expression; that's what a `const` (or a pipe) is for — see
*Principles → Pipe, don't wrap*.

``` ts
// ❌ bad — a yield* wrapped inside another call
yield* emails.add(yield* nextEmail)

// ✅ good — pipe it, no throwaway const
yield* nextEmail.pipe(Effect.andThen(emails.add))

// ✅ also fine — bind to a const, then use
const email = yield* nextEmail
yield* emails.add(email)
```

{#one-field-per-line .must appliesTo="src examples test"}
## One field per line

Never collapse a multi-field object or parameter list onto one line. One field per line, always — a
collapsed literal is unreadable on a narrow screen and buries a bad diff.

``` ts
// ❌ bad — collapsed onto one line
const config = { laneCount: 4, namedLanes: { interactive: 0, batch: 3 }, takeAlgorithm: "weighted" }

// ✅ good — one field per line
const config = {
  laneCount: 4,
  namedLanes: { interactive: 0, batch: 3 },
  takeAlgorithm: "weighted",
}
```

{.note}
**Doc comments live in their own chapter** — how a doc comment is shaped, the `@public` / `@internal` /
`@module` markers, `{@link}` cross-refs, and `@example` rules are all in *Documentation*.
