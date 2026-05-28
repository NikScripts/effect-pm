---
"@nikscripts/effect-pm": minor
---

**Queue `rateLimit`** — Effect `RateLimiter` on workers (before concurrency semaphore).

- `rateLimit` config on `QueueResource` / `Service.configure` (`window`, `limit`, `onExceeded` default `"delay"`)
- `onRateLimitExceeded` hook and `queue.ratelimit.exceeded` on `QueueResourceStore`
- `queueRateLimiterLayer` for in-memory limiter; `record: "off"` skips exceeded telemetry
