---
"hyperlink-ts": minor
---

`Polling.cron(expression)` — ticks on cron-expression occurrences (UTC calendar-aligned) instead
of relative intervals. `requestWake`/`resetCadence` end the current wait early; `peekCadence`
reports time until the next occurrence; an invalid expression fails at construction.
