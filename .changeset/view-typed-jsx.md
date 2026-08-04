---
"last-ts": minor
"hyperlink-ts": minor
---

**Effect v4 naming — Tag → Service:** Context handle mints are `*.Service` (not `*.Tag`). Baked config+layer factories that used to be called `Service` are now `define`. `Store.Service` stays; light descriptors are `Store.descriptor`.

**Views — Effect-native:** Mint with `View.Service`; build layers with `Layer.succeed` / `Layer.effect` + `Effect.gen` (no `View.succeed` / `View.gen` / `View.effect` masks). `View.mount(Service)` uses `Service.layer` (compose deps on the class). Always `yield*` a Service for the component. `Last.toLayer(Svc, function*)` for upward Provides.
