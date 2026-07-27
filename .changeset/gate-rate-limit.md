---
"hyperlink-ts": minor
---

Gate `rateLimit` — Effect `RateLimiter` consumes before the concurrency Semaphore (same orthogonal split as WorkPool). Policy-only config (`limit`, `window`, …); store is presence-driven via `RateLimiterStore` (`serviceOption`), with Soft in-memory when absent. Default `onExceeded` is `"delay"`.
