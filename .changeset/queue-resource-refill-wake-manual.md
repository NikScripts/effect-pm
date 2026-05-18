---
"@nikscripts/effect-pm": patch
---

**QueueResource**: Automatic **`config.refill`** no longer runs on cold start before any enqueue/drain signal; it runs after queues drain empty once activity has awakened the refill monitor (enqueue wake + drain wake when all levels empty). **`QueueHandle`** exposes **`refill`** to invoke **`config.refill`** manually for bootstrap ordering (e.g. **`yield* queue.refill`** before **`yield* queue.start`**).
