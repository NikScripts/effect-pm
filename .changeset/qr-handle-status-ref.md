---
"hyperlink-ts": patch
---

**QueueResource handle — `status` is now a proper `ref` (`{ get, changes }`).** `QueueHandle` / `CustomQueueHandle` no longer expose a bare `status` stream or a separate `statusNow` Effect; read once via `queue.status.get`, subscribe via `queue.status.changes`. Matches `Resource.ref(queueStatus)` on the contract and what `yield* Tag` already surfaced through the impl bridge.
