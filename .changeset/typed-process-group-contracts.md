---
"@nikscripts/effect-pm": minor
---

Add typed process group declarations, contracts, and remote management. Processes and queues can now be registered as canonical class services, `ProcessGroup.make(id, entries)` builds a typed group from a single entries tuple, `ProcessGroup.Service` provides an injectable group, `ControlService` exposes schema-validated group contracts at `GET /contract` plus contract-aligned process/queue REST routes, `ProcessManager.connect` creates a typed remote client for supported process/queue controls, and `ProcessManager.Endpoint` provides that remote client as an injectable Effect service.

`ProcessGroup.remoteLayer` can now provide a group service from a `ProcessManager.Endpoint`. Group service/control errors are widened through `ProcessGroupControlError`, including the new `ProcessGroupRemoteControlError` and `UnsupportedRemoteControlError` exports; remote queue enqueue-style controls remain intentionally unsupported with `UnsupportedRemoteControlError` until schema-backed queue item contracts land.

`ProcessManager.verifyContract` now compares the remote contract's group id, version, process ids, queue ids, and control sets against the local contract before reporting success.

Also fixes `ProcessStore` execution ordering consistency and keyed queue `clear()` dedup cleanup.
