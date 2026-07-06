---
"@nikscripts/effect-pm": minor
---

**Queue durability is now presence-driven — the `persist` config field is removed (breaking).**

A queue becomes durable when a `DurableQueueStore` layer is in context (and the queue has an
`itemSchema` so the payload can serialize) — **providing the layer is the switch.** An in-memory
"durable" store is a contradiction, so durability is intentionally *not* a baked-in default; absence
of the layer is the normal ephemeral in-memory queue.

Removed:

- **`persist` on `QueueResourceConfig`** and the **`QueuePersistOptions`** type. Durability is no
  longer enabled by `persist: true` — provide the `DurableQueueStore` layer instead.

Migration:

- `persist: true` → delete it; provide the `DurableQueueStore` layer (e.g.
  `Layer.succeed(DurableQueueStore, …)` / `SQLiteDurableQueueStore.layer`).
- `persist: { maxAttempts: n }` → set the queue's `attempts` (the dead-letter budget derives to
  `attempts + 1`).
- `persist: { leaseMillis, pollIntervalMillis }` → engine defaults for now (300000 / 100);
  per-backend tuning moves onto the `DurableQueueStore` layer.
- To keep one queue ephemeral while others are durable, scope the `DurableQueueStore` layer so that
  queue does not receive it.
