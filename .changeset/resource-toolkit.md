---
"@nikscripts/effect-pm": minor
---

Location-transparent resource toolkit: drive processes, queues, and schedules with the same `yield* Tag` code whether they run local or remote.

The `Resource` foundation is now a first-class, exported surface, with batteries-included resource kinds built on it. A resource is defined as a `.Tag` (a `Context.Service` class) and its runtime is a separately-composed `.layer` — the same consumer code runs unchanged whether the resource is provided locally or reached over RPC; only the layer differs.

**New / newly-exported:**

- **`Resource`** (foundation) — `Tag` / `layer` / `server` / `serveHttp` / `client` / `connect` / `connectHttp` / `Host`, plus `serveInstances` / `clientInstances` for multi-instance hosting. Contracts are introspectable via the newly-exported **`specOf`** + **`methodMeta`** (`kind` / `description` / `destructive` / `streaming`) — enough to render a generic dashboard/TUI from any tag.
- **`ProcessResource`** (`@nikscripts/effect-pm/ProcessContract`) — a managed process as a toolkit resource: `statusNow` / `status` / `schedule` / `logs` reads, `start` / `stop` / `runImmediately` lifecycle, and `setSchedule` / `addSchedule` / `clearSchedule`. Auto-arms and runs immediately with its layer (pass `schedule: ProcessSchedule.empty` to start disarmed).
- **Toolkit `QueueResource`** (`@nikscripts/effect-pm/QueueContract`) — the priority-queue engine behind a location-transparent contract (control + observation + data-plane, remote-proven over http). The barrel `QueueResource` remains the legacy engine during migration; import the toolkit queue from the subpath.
- **`ProcessScheduleResource`** (`@nikscripts/effect-pm/ProcessScheduleContract`) — a schedule store as its own resource: full CRUD (`entries` / `get` / `has` / `set` / `add` / `upsert` / `remove` / `removeMany` / `clear`), diff-based `reconcile`, and a `changes` stream.
- **`Group`** (`@nikscripts/effect-pm/Group`) — `Group.Tag` organizes member tags into a nestable tree (`members` / `isGroup`). Pure organization with no runtime: members can run on the same or different hosts, each resolving its own transport (no central manager).
- **`HostLogs`** (`@nikscripts/effect-pm/HostLogs`) — runtime-wide log capture + stream.

**Enhancements:**

- **`.configure` for toolkit resources** — `QueueResource.configure(tag, patch)` / `ProcessResource.configure(tag, patch)` return a config-patch layer (keyed by the tag id) that folds onto the layer's base config at build, for per-environment overrides (concurrency / rateLimit / …). The successor to the old `.Service(...).configure(...)`.
- **Process run metrics** — `ProcessSnapshot` / `processStatus` gain `runsStarted` / `runsSucceeded` / `runsFailed` and `lastRunStartedAt` / `lastRunDurationMillis`, counted at the single run boundary so they cover scheduled, polling, and `runImmediately` runs.

All additive — no existing API is removed or changed; the legacy `Process` / `QueueResource` / `ProcessGroup` / `ControlService` surfaces remain during migration.
