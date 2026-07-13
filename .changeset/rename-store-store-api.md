---
"@nikscripts/effect-pm": minor
---

**Breaking:** remove overloaded `Store.store` / `Resource.store`.

- **`Store.scoped(scope, contract)`** — single-scope store class with `layerMemory` / `layer`.
- **`Resource.withStore(contract)`** — tag pipe combinator; adds `yield* Tag.store`.
- **`Store.register`** — unchanged; aggregate registration on `Store.Service`.

`QueueResource.store` / `RunResource.store` / `Process.store` toolkit registrations are unchanged.
