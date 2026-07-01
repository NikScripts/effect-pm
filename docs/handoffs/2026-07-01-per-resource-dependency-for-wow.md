# For wow-sports: per-resource dependencies at the serve — resolved

**Reply to** [`2026-07-01-per-resource-source-provide.md`](./2026-07-01-per-resource-source-provide.md)
(your services-hub report: 9 tick bodies self-providing their handler layer via `Effect.provide`, which
`strictEffectProvide` flags, because heterogeneous per-resource sources can't hoist to `serveAllHttp`'s
single shared provide without double-enqueue).

**Status:** built + tested on branch `cursor/beta-18-dependency-serve`; ships in **effect-pm beta.18**
(not yet released). Vendor the branch to try it now, or wait for the release.

> "source" is your `EventManager` term and stays in wow — the package names nothing after it. What you
> called a per-resource *source* is, to effect-pm, just the resource's requirement `R` (a dependency
> `Layer`). The solution is generic.

## What shipped

Three serving primitives (+ one sugar), so each resource carries **its own** dependency via ordinary
`Layer.provide`, isolated, on one shared `/rpc`:

- `Resource.serve(tag, impl)` — a handler layer that **preserves** the handlers' requirement `R`.
- `Resource.httpServer(options?)` — one `RpcServer` + `/health` over the served resources.
- `Resource.servedResourcesLayer` — the registry the two share.
- `Resource.provide(dependency, [resources])` — "these resources, on this dependency."

Full docs: [`docs/guides/per-resource-dependencies.md`](../guides/per-resource-dependencies.md) and the
`RESOURCE-API.md` "Per-resource dependencies" section. Design + rationale (incl. why not a config field
or branding): [`per-resource-dependency-serve-design.md`](./per-resource-dependency-serve-design.md).

## Migrating your 9 sites

For each tick, **delete the `Effect.provide`** and let the body declare its requirement; provide the
layer on the `serve` instead:

```ts
// before — flagged
export const nwslGetSeasonMatchesTick = myTick.pipe(
  Effect.provide(NwslHub.processTickHandlersLayer),   // ← delete this
);

// after — the body just `yield*`s its handlers; the serve carries the layer
export const nwslGetSeasonMatchesTick = myTick;       // body unchanged bar the deleted provide
Resource.serve(NwslGetSeasonMatches, { run: nwslGetSeasonMatchesTick })
  .pipe(Layer.provide(NwslHub.processTickHandlersLayer));
```

Assemble the host by grouping resources by the handler they share, and giving the exceptional ones their
own layer:

```ts
Resource.httpServer({ health: { path: "/health" } }).pipe(
  Layer.provideMerge(Layer.mergeAll(
    Resource.provide(schemaImportHandlers, [       // bare-client ticks — stateless registry
      Resource.serve(NwslGetSeasonMatches, { run: seasonMatchesTick }),
      Resource.serve(LiveScorePoller,      { run: pollerTick }),
    ]),
    Resource.serve(IncrementalSeasonImport, { run: importTick })
      .pipe(Layer.provide(hookedSourceLayer)),     // phased import — hooked, isolated
    Resource.provide(emptyHookSourceLayer, [       // queue workers — empty-hook
      Resource.serve(NwslRosterImportQueue, { run: rosterWorker }),
      Resource.serve(NwslMediaImportQueue,  { run: mediaWorker }),
    ]),
  )),
  Layer.provide(Resource.servedResourcesLayer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
);
```

The **double-enqueue can't recur**: the hooked source is a separate `Layer.provide` on
`IncrementalSeasonImport` only — the queue workers get the empty-hook one. Sharing is by memoization
(same layer value → one instance; `Layer.fresh` to isolate).

## Two rules

1. **`provideMerge`** (not `provide`) the `serve` layers onto `httpServer` — they must be kept, not
   pruned. A missing handler fails the `RpcServer` at boot, not silently.
2. **Declare, don't provide, in tick bodies** — then set `strictEffectProvide: "error"` and your 9
   sites are clean.

## Note on `serveAllHttp`

Unchanged — keep using it for resources that **share** their dependencies (most hosts). Reach for
`serve` / `httpServer` only where resources need **different** implementations of the same tag (your
import pipeline). They're complementary, not a replacement.
