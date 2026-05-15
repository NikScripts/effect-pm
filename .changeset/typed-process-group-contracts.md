---
"@nikscripts/effect-pm": minor
---

Add typed process group declarations, contracts, and remote management. Processes and queues can now be registered as canonical class services, `ProcessGroup.make(id, entries)` builds a typed group from a single entries tuple, `ProcessGroup.Service` provides an injectable group, `ControlService` exposes schema-validated group contracts at `GET /contract` plus contract-aligned process/queue REST routes, `ProcessManager.connect` creates a typed remote client for supported process/queue controls, and `ProcessManager.Endpoint` provides that remote client as an injectable Effect service.

`ProcessGroup.remoteLayer` can now provide a group service from a `ProcessManager.Endpoint`. Group service/control errors are widened through `ProcessGroupControlError`, including the new `ProcessGroupRemoteControlError` and `UnsupportedRemoteControlError` exports; remote queue enqueue-style controls remain intentionally unsupported with `UnsupportedRemoteControlError` until schema-backed queue item contracts land.

`ProcessManager.verifyContract` now compares the remote contract's group id, version, process ids, queue ids, and control sets against the local contract before reporting success.

`ControlService` is now contract/REST-first: the legacy `POST /control` command endpoint and command request types were removed, and the CLI now calls the REST routes directly.

`ProcessManager.ConnectionRegistry.layer` and `ProcessManager.ConnectionRegistry.layerConfig` can now provide typed group connection URLs; `ProcessManager.connect(Group)` and registry-backed `ProcessManager.Endpoint(Group)` can build remote managers from that registry requirement.

`ProcessManager.cli([GroupA, GroupB])` adds an initial multi-group CLI surface using the connection registry and normalized target resolution for globally unique process and queue ids, including group verification and process/queue status commands.

The multi-group CLI supports `--json` output for `groups`, `ls`, `verify`, and `status <target>`.

The multi-group CLI now checks target contract capabilities before issuing remote controls.

Also fixes `ProcessStore` execution ordering consistency and keyed queue `clear()` dedup cleanup.
