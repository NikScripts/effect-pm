---
"@nikscripts/effect-pm": minor
---

**ShardMap.store** — event-sourced local shards on the Store bridge.

`ShardMap.store(tag)` registers a Put/Delete `event` shape (value schema from the tag) with
analytics reads (`current`, `puts`, `deletes`, `recent`, `stats`, `changes`).

`ShardMap.layer` / `serve` / `serveRemote` merge `Store.layerDefaultMemory`. On build the engine
replays `events()` into the in-memory Map; every `putLocal` / `deleteLocal` appends then updates.
Each droplet's store scope holds **that node's** shard history.
