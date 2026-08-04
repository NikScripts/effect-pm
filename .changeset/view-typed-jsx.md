---
"last-ts": minor
"hyperlink-ts": minor
---

**Effect v4 naming — Tag → Service:** Context handle mints are `*.Service` (not `*.Tag`). Baked config+layer factories that used to be called `Service` are now `define` (`Gate.define`, `WorkPool.define`, `Daemon.define`, `HttpApiClient.define`). `Store.Service` stays the store handle mint; light store descriptors are `Store.descriptor`.

**Views:** `View.Service` / `Views.*.Service` mint handles; attach a default Layer with class `static layer = This.provide(…)` (no `{ default }` bake-in). Compose with `yield* Effect.all` / `yield* Service`; discharge with `View.mount(view, Service.layer)`. Bag `View.succeed({ Child }, …)` removed.
