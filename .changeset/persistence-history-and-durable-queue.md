---
"@nikscripts/effect-pm": minor
---

Persistence — the two-plane design from `docs/handoffs/queue-persistence-design.md`.

**Observability plane (history).** `HistoryStore` — a tiny backend-agnostic append-log
(`append`/`read`, keyed by stream id; `layerMemory` today, SQLite/Postgres later). Each resource
reads it back via `*History` queries **on the same Tag** as the live stream, fully opt-in via
`serviceOption` (no store → empty):
- Queue: `logHistory` + `metricsHistory` (needs `captureLogs` for logs).
- Process: per-process log **capture** (`captureLogs` on the process layer) feeding `logs` +
  `logHistory`.
- Runtime-wide: `HostLogs.persistLayer` + `HostLogs.history` (captures *all* runtime logs).

**Durability plane.** `DurableQueueStore` — a priority-native store of pending + in-flight work so
no enqueued item is lost across a restart (**at-least-once** + dedup key). Inspired by Effect's
`PersistedQueue` (lease / `attempts` / expiry-recovery blueprint) but priority-native, not FIFO:
strict high/normal/low + FIFO within a lane, dedup + escalation on a `dedupKey`, lease + `recover`,
`fail` → requeue/dead-letter, `sizes`. SQLite backend (`SQLiteDurableQueueStore` from
`@nikscripts/effect-pm/storage/sqlite`) over one table; single-writer leasing in a transaction.
The store port is on the core entry (no SQL dep); engine integration lands in a follow-up.

A guide for consumers: `docs/guides/history-and-persistence.md`.
