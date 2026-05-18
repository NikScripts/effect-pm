---
"@nikscripts/effect-pm": minor
---

Add optional deferred worker fork for priority queues: config **`autoStart`** defaults to **`true`** (unchanged behavior). When **`autoStart`** is **`false`**, **`yield* queue.start`** forks the worker pool and the optional **`refill`** fiber; enqueue still succeeds and items accumulate until then. **`start`** is idempotent and becomes a no-op after **`shutdown`** (warning logged).
