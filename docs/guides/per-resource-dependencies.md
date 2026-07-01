# Per-resource dependencies at the serve

When several resources run on one host, they usually **share** their dependencies — one database, one
HTTP client, provided once. `Resource.serveAllHttp` is built for exactly that: it unions every entry's
requirement `R` into a single provide at the serve root.

But sometimes resources on the same host need **different implementations of the same dependency tag**,
and those implementations are **mutually exclusive**. A classic case: an import pipeline where

- some workers use a **plain** handler,
- others use a **hooked** handler that enqueues follow-up work after each row,

and both read the same `ImportHandlers` tag. One shared provide can only supply *one* of those — hand
the hooked handler to a plain worker and you double-enqueue. This guide is about that case.

> If your resources share their dependencies, you don't need any of this — use `serveAllHttp` and provide
> the shared dependency once. Reach for `serve` / `httpServer` only when resources need **different**
> implementations of the same tag.

## The idea in one line

Each resource carries **its own** dependency via ordinary `Layer.provide`, and the resources still share
**one** `/rpc`. No dependency lives in a config object; sharing vs. isolation is governed by Effect's
layer memoization, not by data.

## The three primitives

| Primitive | Role |
|-----------|------|
| `Resource.serve(tag, impl)` | A resource's handler layer. Unlike the internal server layer it **preserves** the handlers' requirement `R`, so you can `Layer.provide` each resource's dependency onto *it*. Self-registers for `/health`. |
| `Resource.httpServer(options?)` | Reads the registry, merges every served group onto **one** `RpcServer` (`/rpc`), and mounts a `/health` route. |
| `Resource.servedResourcesLayer` | The registry `serve` writes to and `httpServer` reads. |
| `Resource.provide(dependency, [resources])` | Sugar for `Layer.mergeAll(resources).pipe(Layer.provide(dependency))` — "these resources, on this dependency." |

## A complete example

```ts
import { Layer } from "effect";
import * as Resource from "@nikscripts/effect-pm/Resource";
import { NodeHttpServer } from "@effect/platform-node";
import { createServer } from "node:http";

// each tick DECLARES its dependency — no Effect.provide in the body
const seasonMatchesImpl = {
  run: Effect.gen(function* () {
    const handlers = yield* ImportHandlers;      // required, not provided here
    yield* handlers.fetchAndPersist(/* … */);
  }),
};

const Host = Resource.httpServer({ health: { path: "/health" } }).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      // resources that share the plain handler → state it once with `provide`
      Resource.provide(plainImportHandlers, [
        Resource.serve(SeasonMatches,   seasonMatchesImpl),
        Resource.serve(LiveScorePoller, pollerImpl),
      ]),
      // a resource that needs the hooked handler → its own Layer.provide, isolated
      Resource.serve(SeasonImport, importImpl).pipe(Layer.provide(hookedImportHandlers)),
    ),
  ),
  Layer.provide(Resource.servedResourcesLayer),  // shared registry
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3001 })),
);
```

`SeasonImport` gets the hooked handler; `SeasonMatches` and `LiveScorePoller` get the plain one — on one
`/rpc`, with `/health` listing all three. A client reaches each with `Resource.client(Tag)` as usual.

## How it works

- **Isolation.** `Resource.serve` keeps the handlers' requirement in the layer's type, so
  `Layer.provide(dep)` discharges *that* resource's dependency before anything merges. Two resources with
  different implementations of the same tag are two separate provides — they can't collide.
- **One server.** RPC groups are namespaced by the resource's wire id, so many served groups merge onto a
  single `RpcServer` with no clash. `httpServer` does that merge from the registry.
- **The registry + ordering.** Each `serve` layer appends its `{ group, kind, readiness }` to a
  `Ref`-backed `ServedResources`; `httpServer` reads it to build the server and `/health`. Because you
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
Resource.serve(MyResource, { run: tick }).pipe(Layer.provide(handlersLayer));
```

Nothing in the body changes except deleting the `Effect.provide`.
