---
"@nikscripts/effect-pm": patch
---

**ApiMetrics — `usage` is now a `ref` (`{ get, changes }`).** Drops `usageNow`; read cumulative totals via `usage.get`, subscribe via `usage.changes` (emits on each recorded request). Windowed `metrics` stream is unchanged.
