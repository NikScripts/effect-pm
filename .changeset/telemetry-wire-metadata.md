---
"@nikscripts/effect-pm": minor
---

Add telemetry wire metadata helpers.

- `Telemetry.events(definition)` returns the PascalCase wire ids derived from a telemetry definition.
- `Telemetry.events(definition, tag)` returns the wire ids for a specific tag path.
- `Telemetry.Type.Wire<T>` and `Telemetry.Type.Event<T, Tag>` derive literal wire unions from the telemetry definition without widening emitter leaves.
- `ProcessExecutionStore`, `ProcessLifecycleStore`, and `ProcessGroupStore` derive their PascalCase wire ids from telemetry definitions; the legacy `ProcessLifecycleRecordInput` export is removed.
