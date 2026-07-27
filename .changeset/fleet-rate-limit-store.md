---
"hyperlink-ts": minor
---

Fleet rate limiting: Gate and WorkPool resolve `RateLimiter` / `RateLimiterStore` from Context (Soft memory only when absent). WorkPool no longer auto-merges an in-memory rate-limiter layer onto queue layers (that blocked Redis). Shared-store fleet tests + Gate fleet recipe/docs.
