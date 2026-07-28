# Per-hyperlink dependencies at the serve

> **Live book:** the current recipe is
> [Managing Layers → HyperServices may require other services](../../getting-started/managing-layers.md)
> (and the must-rule *Serve / listen / `*Server` preserve open `R`* in standards). This legacy page
> keeps the long-form example; APIs below may say `Hyperlink.httpServer` / `Daemon` where today's
> surface is `Node.httpServer` / `Daemon`.

When several resources run on one host, they usually **share** their dependencies — one database, one
HTTP client, provided once. `Hyperlink.httpServer([...serve-layers])` handles that directly: provide the
shared dependency once (to the whole set, or via `Hyperlink.provide`) and every resource memoizes the
same instance.

But sometimes resources on the same host need **different implementations of the same dependency tag**,
and those implementations are **mutually exclusive**. A classic case: an import pipeline where

- some workers use a **plain** handler,
- others use a **hooked** handler that enqueues follow-up work after each row,

and both read the same `ImportHandlers` tag. One shared provide can only supply *one* of those — hand
the hooked handler to a plain worker and you double-enqueue. This guide is about that case.

> If your resources share their dependencies, provide the shared dependency once — every `serve` layer
> in the set memoizes the same instance. Reach for a **per-layer** `Layer.provide` only when resources
> need **different** implementations of the same tag.

## The idea in one line

Each resource carries **its own** dependency via ordinary `Layer.provide`, and the resources still share
**one** `/rpc`. No dependency lives in a config object; sharing vs. isolation is governed by Effect's
layer memoization, not by data.

## The three primitives

| Primitive | Role |
|-----------|------|
| `Hyperlink.serve(tag, impl)` | A **raw resource's** layer (impl is the query record) that grants the local instance **and** mounts the wire handlers, **preserving** the handlers' requirement `R`, so you can `Layer.provide` each resource's dependency onto *it*. Self-registers for `/health`. (`serveRemote` is the served-only variant — same isolation, no local grant.) |
| `WorkPool.serve(tag, config)` / `Daemon.serve(tag, config)` | The **engine** forms — same isolation, but the served layer also **runs the engine** (worker/refill/persist for queues, tick schedule for processes). Use these for queue/process resources; `Hyperlink.serve` only mounts handlers and would leave the worker/tick dead. |
| `Hyperlink.httpServer(options?)` | Reads the registry, merges every served group onto **one** `RpcServer` (`/rpc`), and mounts a `/health` route. |
| `Hyperlink.servedHyperServicesLayer` | The registry the `serve` forms write to and `httpServer` reads. |
| `Hyperlink.provide(dependency, [resources])` | Sugar for `Layer.mergeAll(resources).pipe(Layer.provide(dependency))` — "these resources, on this dependency." |

> **Query resource vs. engine resource.** A bare `Hyperlink.Tag` (status queries, streams) uses
> `Hyperlink.serve(tag, recordImpl)`. A `WorkPool` / `Daemon` is an **engine** — its worker
> or tick must actually run — so use `WorkPool.serve(tag, config)` / `Daemon.serve(tag,
> config)`. Both are `serve`-style layers (preserve `R`, register for `/health`); the engine forms just
> also start the engine. Composing an engine tag with `Hyperlink.serve` would mount its RPC surface but
> never run the worker.

## A complete example

```ts
import { Layer } from "effect";
import * as Hyperlink from "hyperlink-ts/Hyperlink";
import * as Daemon from "hyperlink-ts/Daemon";
import { NodeHttpServer } from "@effect/platform-node";
import { createServer } from "node:http";

// each tick body DECLARES its dependency — no Effect.provide in the body
// { effect: Effect.gen(function* () { const handlers = yield* ImportHandlers; … }), polling, … }

// httpServer([...serve layers], options) bundles the provideMerge + registry — list resources, provide
// only the platform (and any shared dependency).
const Host = Hyperlink.httpServer(
  [
    // processes that share the plain handler → state it once with `provide`
    Hyperlink.provide(plainImportHandlers, [
      Daemon.serve(SeasonMatches,   seasonMatchesCfg),
      Daemon.serve(LiveScorePoller, pollerCfg),
    ]),
    // a process that needs the hooked handler → its own Layer.provide, isolated
    Daemon.serve(SeasonImport, importCfg).pipe(Layer.provide(hookedImportHandlers)),
  ],
  { health: { path: "/health" } },
).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3001 })));
```

> The low-level form `httpServer(options)` still exists — then you `Layer.provideMerge` the `serve` layers
> (kept, not pruned) + `Hyperlink.servedHyperServicesLayer` yourself. The `serves` form removes that boilerplate
> and the `provideMerge`-vs-`provide` footgun.

`SeasonImport` gets the hooked handler; `SeasonMatches` and `LiveScorePoller` get the plain one — on one
`/rpc`, with `/health` listing all three. A client reaches each with `Hyperlink.client(Tag)` as usual.

## How it works

- **Isolation.** `Hyperlink.serve` keeps the handlers' requirement in the layer's type, so
  `Layer.provide(dep)` discharges *that* resource's dependency before anything merges. Two resources with
  different implementations of the same tag are two separate provides — they can't collide.
- **One server.** RPC groups are namespaced by the resource's wire id, so many served groups merge onto a
  single `RpcServer` with no clash. `httpServer` does that merge from the registry.
- **The registry + ordering.** Each `serve` layer appends its `{ group, kind, readiness }` to a
  `Ref`-backed `ServedHyperServices`; `httpServer` reads it to build the server and `/health`. Because you
  `provideMerge` the `serve` layers **onto** `httpServer`, they build (and register) **before**
  `httpServer` reads — the dependency chain guarantees it.
- **Sharing by memoization.** Provide the *same* dependency `Layer` value to two resources and they share
  one instance; wrap it in `Layer.fresh(dep)` (or use different values) to force separate instances.

## Two rules

1. **`provideMerge`, not `provide`, for the `serve` layers.** They supply the handlers but no service
   `httpServer`'s *type* requires (handlers flow dynamically), so a bare `Layer.provide` would prune them.
   `provideMerge` keeps them. A missing handler fails the `RpcServer` at **boot** — a clear error, never a
   silent runtime gap.
2. **Declare, don't provide, in the body.** The tick/worker `yield*`s its dependency tag; the layer
   provides it. So no `Effect.provide` appears in your resource bodies, and you can run
   `@effect/language-service` with `strictEffectProvide: "error"`.

## Migrating from `Effect.provide` in tick bodies

If today a body self-provides its dependency:

```ts
// before — flagged by strictEffectProvide
const tick = myEffect.pipe(Effect.provide(handlersLayer));
```

move the provide to the serve:

```ts
// after — the body declares R; the serve carries the layer
const tick = myEffect;                                  // just `yield* Handlers` inside
Hyperlink.serve(MyResource, { run: tick }).pipe(Layer.provide(handlersLayer));
```

Nothing in the body changes except deleting the `Effect.provide`.

## When **not** to hoist `Effect.provide` to `serve`

Blanket advice (“move every in-body `Effect.provide` to the serve”) is wrong when the dependency is
**sub-effect-scoped**, not whole-resource.

| Scope | Where to provide | Why |
|-------|------------------|-----|
| **Whole-resource** | At `serve` / edge `Layer.provide` | Same instance for every tick/handler; keeps `strictEffectProvide` clean |
| **Sub-effect** | Keep a scoping combinator in the **app** (e.g. `withImport(handlers, effect)`) | Hoisting widens `R` for the **entire** body and can change behavior without a type error |

Classic case: an outer windowing/scheduler path must **not** capture a handler, while an inner tick
must. If you hoist that handler to the resource edge, the outer path can see it too.

Do **not** look for a package `locally` / `withImport` helper for this — consumer handler tags aren’t
hyperlink-ts types. Keep your own small scoping combinator next to the handler service.
