---
"@nikscripts/effect-pm": minor
---

**Durable log store tails:** toolkit `Process.store` / `QueueResource.store` / `RunResource.store` / `CustomQueueResource.store` registrations now include an implicit `log` shape (`LogEntry`) and, when composed with `Logs.layer` via `Layer.provideMerge`, fork a Stream-based relay follower that filters by lineage + store log level, memos `(scopeKey, lineId)`, batches, and `handle.log.append`s.

```ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Daily),
) {}

// tails see LogRelay at store layer build time
AppStore.layerMemory.pipe(Layer.provideMerge(Logs.layer))

const handle = yield* AppStore.at(Daily)
const rows = yield* handle.log.read()
```

Relay publish stamps a monotonic `lineId` annotation for memo identity. Interim `Logs.persistLayer` / `LogStore` are unchanged.
