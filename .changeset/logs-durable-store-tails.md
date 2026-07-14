---
"@nikscripts/effect-pm": minor
---

**Durable log store tails:** toolkit `Process.store` / `QueueResource.store` / `RunResource.store` / `CustomQueueResource.store` registrations include an implicit `log` shape (`LogEntry`). `Store.Service` `layerMemory` / `layer` bake in `Logs.layer` (relay + capture) and fork per-registration Stream followers (lineage + store log level + `(scopeKey, lineId)` memo → `handle.log.append`).

```ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Daily),
) {}

Effect.provide(program, AppStore.layerMemory)
const rows = yield* (yield* AppStore.at(Daily)).log.read()
```

Relay publish stamps a monotonic `lineId` annotation. Interim `Logs.persistLayer` / `LogStore` are unchanged.
