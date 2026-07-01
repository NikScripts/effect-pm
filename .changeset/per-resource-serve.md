---
"@nikscripts/effect-pm": minor
---

**Per-resource dependencies at the serve — `Resource.serve` / `Resource.httpServer`.** When resources on
one host need **different implementations of the same dependency tag** (mutually exclusive — e.g. a
hook-firing handler for one, a plain one for another), `serveAllHttp`'s single unioned provide can't tell
them apart. The new primitives give each resource **its own** `Layer.provide`, isolated, on one shared
`/rpc`:

- `Resource.serve(tag, impl)` — a handler layer that **preserves** the handlers' requirement `R` (via
  `ServeRequirements<Impl>`), so a per-resource `Layer.provide` discharges it. Self-registers for `/health`.
- `Resource.httpServer(options?)` — reads the served-resources registry, merges every group onto one
  `RpcServer` (`/rpc`), and mounts a `/health` route. `provideMerge` the `serve` layers onto it.
- `Resource.servedResourcesLayer` / `Resource.ServedResources` — the registry `serve` writes and
  `httpServer` reads.
- `Resource.provide(dependency, [resources])` — sugar for
  `Layer.mergeAll(resources).pipe(Layer.provide(dependency))`.

Dependencies compose via ordinary `Layer.provide` (no config-embedded layer, no branding); sharing is by
memoization (same value → one instance, `Layer.fresh` to isolate). Tick/worker bodies just declare their
requirement — no `Effect.provide`, so consumers can run `strictEffectProvide: "error"`. `serveAllHttp` is
unchanged and stays the tool for the shared-dependency case. New public types: `ServeMethod`,
`ServeImplOf`, `ServeRequirements`, `ServedResource`. Guide: `docs/guides/per-resource-dependencies.md`.
