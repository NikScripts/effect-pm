---
"hyperlink-ts": minor
---

**Queue config: `retries` removed** — use `attempts` only.

`QueueResourceConfig.attempts` is the SSOT (initial try + auto re-enqueues). The deprecated `retries` (= attempts − 1) config field is gone. Internal per-item attempt tracking is unchanged.
