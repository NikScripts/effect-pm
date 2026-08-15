---
"last-ts": minor
"hyperlink-ts": minor
---

**Effect v4 naming — Tag → Service:** Context handle mints are `*.Service` (not `*.Tag`). Baked config+layer factories that used to be called `Service` are now `define`. `Store.Service` stays; light descriptors are `Store.descriptor`.

**Views — Effect-native:** Mint with `View.make`; build layers with `Layer.succeed` / `Layer.effect` + `Effect.gen`. Edge: `Last.provide(Service, Service.layer)`. Always `yield*` a Service for the component.
