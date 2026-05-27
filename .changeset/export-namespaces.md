---
"@nikscripts/effect-pm": minor
---

Organize public exports into namespace objects while keeping short root import aliases.

Add namespaces across runtime, storage, control, and process-manager modules (`Query`, `ResourceConfigure`, `DisarmedIdleSleep`, `Cli`, `RuntimeStorage`, `ControlProtocol`, `Process`/`ProcessGroup`/`QueueResource` nested `Errors`/`Schema`, `Logs`, `LogEntry`, `LogContext`, expanded `ProcessManager`). Root exports such as `And`, `configureLayer`, `createCli`, and `Endpoint` remain the same bindings as their namespace members (`Query.And`, `ProcessManager.Endpoint`, etc.).

New subpaths: `@nikscripts/effect-pm/ResourceConfigure` and `@nikscripts/effect-pm/ControlProtocol`.
