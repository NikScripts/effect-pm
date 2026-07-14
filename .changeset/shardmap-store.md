---
"@nikscripts/effect-pm": minor
---

**ShardMap** local shards are SQLite SSOT (not the Store bridge).

`ShardMap.layer` / `serve` / `serveRemote` open an in-memory SQLite client by default
(`:memory:`). Pass `{ filename }` for a durable file. Table `effect_pm_shard_map` holds one
row per live `(scope_key, entry_key)` — boot `SELECT`s, mutations `UPSERT` / `DELETE`. Hot path
keeps a `Ref<Map>` cache. No `ShardMap.store`, no event replay.
