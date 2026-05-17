---
"@nikscripts/effect-pm": minor
---

**Breaking:** `Process.make` now requires `(id, config)`; the single-object form with `name` in config is removed. `ProcessMakeOptions` is the public config type (no `name` field). `Process.providePolling` and `Process.provideSchedule` take `id` as the first argument.
