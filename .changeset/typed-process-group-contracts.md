---
"@nikscripts/effect-pm": minor
---

Add typed process group declarations, contracts, and remote management. Processes and queues can now be registered as canonical class services, `ProcessGroup.make(id, entries)` builds a typed group from a single entries tuple, `ProcessGroup.Service` provides an injectable group, `ControlService` exposes schema-validated group contracts at `GET /contract` plus contract-aligned process/queue REST routes, `ProcessManager.connect` creates a typed remote client for supported process/queue controls, and `ProcessManager.Endpoint` provides that remote client as an injectable Effect service.

`ProcessGroup.remoteLayer` can now provide a group service from a `ProcessManager.Endpoint`. Group service/control errors are widened through `ProcessGroupControlError`, including the new `ProcessGroupRemoteControlError` and `UnsupportedRemoteControlError` exports; remote queue enqueue-style controls remain intentionally unsupported with `UnsupportedRemoteControlError` until schema-backed queue item contracts land.

`ProcessManager.verifyContract` now compares the remote contract's group id, version, process ids, queue ids, and control sets against the local contract before reporting success.

`ControlService` is now contract/REST-first: the legacy `POST /control` command endpoint and command request types were removed, and the CLI now calls the REST routes directly.

`ProcessManager.ConnectionRegistry.layer` and `ProcessManager.ConnectionRegistry.layerConfig` can now provide typed group connection URLs; `ProcessManager.connect(Group)` and registry-backed `ProcessManager.Endpoint(Group)` can build remote managers from that registry requirement.

`ProcessManager.cli([GroupA, GroupB])` adds an initial multi-group CLI surface using the connection registry and normalized target resolution for globally unique process and queue ids. It supports `groups`, `ls`, `verify`, `status <target>`, process `start` / `stop` / `restart` / `now`, and queue `pause` / `resume` / `clear`.

The multi-group CLI supports `--json` output for `groups`, `ls`, `verify`, and `status <target>`.

The multi-group CLI now checks target contract capabilities before issuing remote status/control requests, so unsupported process and queue commands fail locally before HTTP.

Adds the first runtime state/fact vocabulary and optional `RuntimeObserver`, with `RunResource` publishing run started/completed/failed facts when an observer is provided. `RuntimeObserver.layerProcessStore` persists runtime facts as `runtime.fact.recorded` ProcessStore analytics events, and the Prisma codec supports that event type. State changes are not persisted yet.

`RuntimeObserver.layerListeners(listeners)` adds scoped fact/state listener support with listener failure isolation.

`ProcessStore.events(query)` now provides a generic storage-neutral event read across memory, file-backed, and Prisma implementations. Dedicated queue completion and lifecycle reads are also available across those stores.

`RunResource` now publishes `RunResourceState` changes for waiting, started, completed, failed, and interrupted runs when `RuntimeObserver` is provided.

`ProcessStore.file(filePath)` and `ProcessStore.fileLayer(filePath)` add an Effect `FileSystem`-backed NDJSON store for local durable analytics events.

Adds dedicated package subpaths for service/resource imports (`/Process`, `/QueueResource`, `/ProcessGroup`, `/ProcessStore`, `/ProcessManager`, `/ControlService`) and storage adapters (`/storage/file`, `/storage/prisma`). Root imports and the legacy `/prisma` subpath remain compatible.

Also fixes `ProcessStore` execution ordering consistency and keyed queue `clear()` dedup cleanup.
