---
"@nikscripts/effect-pm": minor
---

**Tag APIs are now uniform, tree-shakeable module namespaces** (Effect-style) — `import * as X`, no object literals.

- `Resource` and `Group` were object literals (`export const Resource = {…}`), so `import * as Resource` / tree-shaking couldn't work. They're now per-member module namespaces: `import * as Resource from "@nikscripts/effect-pm/Resource"` → `Resource.Tag` / `Resource.Host` pull only what's used; same for `Group`.
- The `@nikscripts/effect-pm/QueueResource` **subpath** previously resolved to the internal engine — an object whose `Tag` had **no `host`** and didn't tree-shake. It now resolves to the namespace: `import * as QueueResource from ".../QueueResource"` gives the **host-ful** contract `Tag`, and `QueueResource.Tag` tree-shakes (~207 KB → ~27 KB). `/ScheduledProcess` already behaved this way.
- The bare `queueTag` / `processTag` exports are removed — define resources via `QueueResource.Tag` / `ScheduledProcess.Tag` (both carry the `host` overload).
- The same object-literal → module-namespace conversion now covers `Logs`, `Query`, `LogContext`, `LogEntry`, `NodeLogs`, `RunResource`, `HttpApiResource`, `HttpClientRunGate`, and `ResourceConfigure`: their members are flat top-level exports and the module **is** the namespace (`import * as Logs`, `import * as RunResource`, …). All documented members are preserved — the flat root re-exports (`And`, `captureLoggerLayer`, `LogAnnotationKeys`, `acceptJson`, `configureLayer`, …) and the namespace members (`Query.And`, `Logs.captureLoggerLayer`, `LogEntry.Schema`, `NodeLogs.layer`, `RunResource.Tag`, `HttpApiResource.Service`, `ResourceConfigure.tagKey`, …) are the same bindings. `RunResource.Tag` / `HttpApiResource` now tree-shake their gate/runner and client-builder engines out of a partial import.

**BREAKING.** Migrate consumers:
`import { Resource } from ".../Resource"` → `import * as Resource from ".../Resource"`;
`import { QueueResource } from ".../QueueResource"` → `import * as QueueResource from ".../QueueResource"`;
`queueTag<T>()(…)` → `QueueResource.Tag<T>()(…)`, `processTag<T>()(…)` → `ScheduledProcess.Tag<T>()(…)`.
`ProcessStorage` also converts: `layer` / `layerRuntimeStorage` and the facet aliases (`ProcessStorage.Log` / `.QueueResource` / …) are flat exports, and `ProcessStorage.Services` is a flat `type` export.

Direct subpath value imports `import { NodeLogs } from ".../NodeLogs"` (and likewise `ProcessStorage`, `RunResource`, `HttpApiResource`) → `import * as Name from ".../Name"`. The barrel forms (`import { NodeLogs } from "@nikscripts/effect-pm"`, etc.) are unchanged.
