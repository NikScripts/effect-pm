---
"last-ts": minor
"hyperlink-ts": minor
---

**Effect v4 naming — Tag → Service:** Context handle mints are `*.Service` (not `*.Tag`). Baked config+layer factories that used to be called `Service` are now `define` (`Gate.define`, `WorkPool.define`, `Daemon.define`, `HttpApiClient.define`). `Store.Service` stays the store handle mint; light store descriptors are `Store.descriptor`.

**Views — Layer-first:** `View.succeed(Service, impl)` / `View.gen(Service, function*)` / `View.effect(Service, fx)` build Layers (twins of `Layer.succeed` / `Layer.effect`). Attach with `static layer = …`. Always `yield*` a Service to get a component; `View.mount(Service, layer)` is the only JSX edge. Removed: unary `View.succeed(fn)`, freestanding `View.gen(function*)`, `View.provide` / `Service.provide`, bag compose, `{ default }` bake-in.
