---
"@nikscripts/effect-pm": minor
---

**Storage composition — soft-default Memory (R fulfilled), override via provide.**

- `Process` / `QueueResource` / `CustomQueueResource` / `RunResource` `layer` / `serve` / `serveRemote` soft-default `Store.layerDefaultMemory` via `Store.withDefaultStorage` — **R is fulfilled** out of the box. `*Memory` variants are aliases of the same soft-default (no Logs).
- Override: feed your app store **into** the toolkit layer so Soft unwrap sees ambient `Storage` — `engine.layer(…).pipe(Layer.provideMerge(AppStore.layer…))` or `httpServer([…]).pipe(Layer.provide(AppStore.layer…))`. Sibling `Layer.merge` does **not** override (SQLite stays empty).
- `Store.Service.layer({ filename })` — **`filename` required**; use `layerMemory` for in-memory + Logs.
- Durable `_logs` tails die if `LogRelay` is missing; a second `Logs.layer` / second `Store.Service.layer*` in one runtime dies (one bus per Node).
- Guide SSOT: `docs/guides/stores.md`.
