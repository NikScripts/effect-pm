---
"hyperlink-ts": minor
---

Add `ProcessGroup.localEnvLayer` and `ProcessGroupServiceDefinition.localEnvLayer` to compose child runtime env layers without duplicate queue merges. Export `ProcessGroupServiceLayerProvided` on `ProcessGroup.Service.layer` for accurate requirement typing.

Add `ProcessManager.groupLocalRuntime` as a one-liner `LocalRuntime` + HTTP control descriptor.

Fix `ControlRouter.layerFromGroup` to accept groups with bundled endpoint config items.
