---
"@nikscripts/effect-pm": minor
---

**Engine-aware `serve` — `QueueResource.serve` / `ScheduledProcess.serve`.** The beta.18 `Resource.serve`
is query-only (mounts RPC handlers, runs no engine), so it can't serve queue/process resources with
isolated per-resource dependencies. These new forms are the engine-running counterparts: they run the
worker / refill / `persist` (queues) or tick schedule (processes) engine, mount the RPC handlers, register
into `Resource.servedResourcesLayer`, **and preserve the worker/tick requirement `R`** so a per-resource
`Layer.provide` isolates it — composed under `Resource.httpServer` exactly like `Resource.serve`:

```ts
Resource.httpServer().pipe(
  Layer.provideMerge(Layer.mergeAll(
    ScheduledProcess.serve(SeasonImport, importCfg).pipe(Layer.provide(hookedSource)),
    QueueResource.serve(RosterQueue, rosterCfg).pipe(Layer.provide(emptyHookSource)),
  )),
  Layer.provide(Resource.servedResourcesLayer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
);
```

Same shape as the existing `serveHttp` (`Layer.unwrap(Effect.map(buildEngineImpl(tag, config), (impl) =>
Resource.serve(tag, impl)))`). Resolves wow-sports' engine-resource gap — their 9 `strictEffectProvide`
sites (all queues/processes) can now migrate. `serveAllHttp` + `serverEntry` stay the shared-dependency
tool.
