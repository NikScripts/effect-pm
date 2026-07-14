---
"@nikscripts/effect-pm": minor
---

**Durable log store tails:** toolkit `Process.store` / `QueueResource.store` / `RunResource.store` / `CustomQueueResource.store` and `Resource.store(Node)` / `Node.logs` include an implicit `log` shape (`LogEntry`). `Store.Service` `layerMemory` / `layer` bake in `Logs.layer` (relay + capture) and fork per-registration Stream followers (match + store log level + `(scopeKey, lineId)` memo → `handle.log.append`).

```ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  BillingNode.logs,
  Process.store(Daily),
) {}

Effect.provide(program, AppStore.layerMemory)
const rows = yield* Logs.byNode(BillingNode)
```

- Relay publish stamps a monotonic `lineId` annotation.
- Node + resource registrations may both keep a copy of the same line (per-scope memo).
- `Store.streamLevel*` / `Resource.logStreamLevel*` gate live `Resource.logs` streams (distinct from durable `Store.logLevel*`).
- `NodeStatus.logs.query` prefers registration Storage (node key inferred from served tags / `httpServer({ node })`).
- Interim `Logs.persistLayer` / `LogStore` remain as a deprecated fallback — do not dual-compose with `Node.logs` for the same node.
