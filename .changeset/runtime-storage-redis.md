---
"hyperlink-ts": minor
---

**Redis `RuntimeStorage` adapter** (`@nikscripts/effect-pm/storage/redis`).

- `RedisRuntimeStorage.layer` / `layerProcessStore` — full `RuntimeStorageService` over a `send(command, …args)` transport.
- `makeInMemoryRedisSend` for tests without a Redis server.
- Same query, readonly, and `transaction` semantics as memory and SQLite adapters.
