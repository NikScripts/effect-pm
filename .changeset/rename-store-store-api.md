---
"@nikscripts/effect-pm": minor
---

**Breaking:** remove overloaded `Store.store` / `Resource.store`; single-registration `Store.Service` yields the handle directly.

- **`Store.scoped(scope, contract)`** — single-scope store class with `layerMemory` / `layer`.
- **`Resource.withStore(contract)`** — tag pipe combinator; adds `yield* Tag.store`.
- **`Store.register`** — unchanged; aggregate registration on `Store.Service`.
- **Bare single `Store.Service` registration** (e.g. `QueueResource.store(Mail)`) — `yield* MailStore` returns the handle; no `.at()`. Multi-store (`[]`, `{}`, or multiple rest args) keeps `yield* AppStore.at(key)`.

`QueueResource.store` / `RunResource.store` / `Process.store` toolkit registrations are unchanged.
