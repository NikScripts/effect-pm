---
"@nikscripts/effect-pm": minor
---

**Storage composition you can’t get wrong (toolkit requires `Storage`).**

- `Process` / `QueueResource` / `CustomQueueResource` / `RunResource` `layer` / `serve` / `serveRemote` now **require** `Store.Storage`. Soft-default ephemeral journals move to `*Memory` variants (`layerMemory`, `serveMemory`, `serveRemoteMemory`) which merge `Store.layerDefaultMemory` (no Logs).
- App stores: `engine.layer(…).pipe(Layer.provideMerge(AppStore.layer…))` or `httpServer([…]).pipe(Layer.provide(AppStore.layer…))` so engines capture the app journal — including **SQLite** (previously silent empty under baked `provideMerge(layerDefaultMemory)`).
- `Store.Service.layer({ filename })` — **`filename` required**; use `layerMemory` for in-memory + Logs.
- Durable `_logs` tails die if `LogRelay` is missing; a second `Logs.layer` / second `Store.Service.layer*` in one runtime dies (one bus per Node).
- Guide SSOT: `docs/guides/stores.md`.
