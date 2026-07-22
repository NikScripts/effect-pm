---
"hyperlink-ts": minor
---

**`Resource.monitoredDependency`** — factory for the repeated dependency-monitor contract: `status` effect + `changes` stream + readiness from `readyWhen` / optional `detail`. Options field names match the spec (`status` / `changes`). Still a plain `Resource.Tag` shape (not a new kind); attach with `withReadiness`. Types: `Resource.MonitoredDependencyOptions` / `Resource.MonitoredDependency` / `Resource.MonitoredDependencySpec`.
