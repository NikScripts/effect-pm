---
"hyperlink-ts": minor
---

**Flat module namespaces for the remaining Tag/service modules (breaking).** Continues the object-literal →
module-namespace conversion started in beta.9 (`Resource`, `Group`, `QueueResource`): the module now **is** the
namespace (`import * as Name`), members are flat top-level exports, and partial imports tree-shake.

Now converted: **`Logs`**, **`Query`**, **`LogContext`**, **`LogEntry`**, **`NodeLogs`**, **`RunResource`**,
**`HttpApiResource`**, **`HttpClientRunGate`**, **`ResourceConfigure`**, and **`ProcessStorage`**. All documented
members are preserved — the flat root re-exports (`And`, `captureLoggerLayer`, `LogAnnotationKeys`, `acceptJson`,
`configureLayer`, …) and the namespace members (`Query.And`, `Logs.captureLoggerLayer`, `LogEntry.Schema`,
`NodeLogs.layer`, `RunResource.Tag`, `HttpApiResource.Service`, `ResourceConfigure.tagKey`, …) are the same
bindings. `RunResource.Tag` / `HttpApiResource` now tree-shake their gate/runner and client-builder engines out
of a partial import. `ProcessStorage`'s `layer` / `layerRuntimeStorage`, the facet aliases (`ProcessStorage.Log`
/ `.QueueResource` / …), and `ProcessStorage.Services` (now a flat `type`) convert likewise.

Internally, `QueueResource` and `CustomQueueResource` moved their engines under `src/internal/` so the public
subpaths carry only the tree-shakeable contract `Tag` (no public-surface change — the subpaths already resolved
to the namespace since beta.9).

**Migration.** Direct subpath **value** imports of the converted namespace objects change form:
`import { NodeLogs } from ".../NodeLogs"` → `import * as NodeLogs from ".../NodeLogs"` (and likewise
`ProcessStorage`, `RunResource`, `HttpApiResource`, `HttpClientRunGate`, `ResourceConfigure`, `Logs`, `Query`,
`LogContext`, `LogEntry`). The barrel forms (`import { NodeLogs } from "hyperlink-ts"`, …) are
unchanged.
