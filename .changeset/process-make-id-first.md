---
"@nikscripts/effect-pm": minor
---

**Breaking:** `Process.make` now requires `(id, config)` or `(id, effect, …)`; the single-object form with `name` in config is removed. `ProcessMakeOptions` is the public config type (no `name` field). `Process.providePolling` and `Process.provideSchedule` are removed; pass preset polling/schedule layers positionally or on the config object.
