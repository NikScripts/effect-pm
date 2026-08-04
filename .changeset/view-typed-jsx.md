---
"last-ts": minor
---

**Views — Service + mount:** `View.Service` mirrors `Context.Service`; `{ default }` bakes `.layer`. Open-`R` views are `Unresolved`; compose with `yield* Effect.all` / `yield* Service`; discharge with `View.mount(view, Service.layer)`. Bag `View.succeed({ Child }, …)` removed. Prefer `View.Service` over `View.Tag`.
