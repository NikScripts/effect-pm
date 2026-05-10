---
"@nikscripts/effect-pm": minor
---

**Breaking — Process v2 (effect-first):** `Process.make` now takes `effect` plus optional **`polling`** and **`schedule`** layers (`Polling`, `ProcessSchedule`) instead of inline `crons`. Layers may be omitted at `make` and provided when forking `process.effect`, or attached via `Process.providePolling` / `Process.provideSchedule`.

Adds `Polling` / `ProcessSchedule` services and presets, expands `ProcessDetails` / group status for gate + cadence hints, updates tests and docs. See `MIGRATION_0.7.0-process-v2.md`.
