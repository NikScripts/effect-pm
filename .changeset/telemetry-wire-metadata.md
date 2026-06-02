---
"@nikscripts/effect-pm": minor
---

Add telemetry wire metadata helpers.

- `Telemetry.events(definition)` returns the PascalCase wire ids derived from a telemetry definition.
- `Telemetry.events(definition, tag)` returns the wire ids for a specific tag path.
- `Telemetry.index(...)` stamps runtime record index columns from schema event fields.
- Input-shaped schema emitters expose `.batch(inputs)` and write via one facet batch operation.
- `Telemetry.Type.Wire<T>` and `Telemetry.Type.Event<T, Tag>` derive literal wire unions from the telemetry definition without widening emitter leaves.
- `Telemetry.codec(definition)(handlers)` routes runtime records through handlers keyed by the telemetry tree and exposes derived `types`, `decode`, and `decodeTag` helpers.
- `ProcessExecutionStore`, `ProcessLifecycleStore`, and `ProcessGroupStore` derive their PascalCase wire ids from telemetry definitions; the legacy `ProcessLifecycleRecordInput` export is removed.
- `RunResourceStore`, `ProcessExecutionStore`, and `ProcessLifecycleStore` use `Telemetry.codec(...)` for runtime record routing; `RunResourceStore` drops decode support for old lowercase `run-resource.*` envelopes and reasons.
