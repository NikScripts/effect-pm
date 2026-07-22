---
"hyperlink-ts": minor
---

**Retire `ScheduledProcess` and privatize the schedule primitive (breaking).** The managed-process
surface is now a single module: **`Process`** carries both the toolkit contract (`Process.Tag`) and
the engine (`Process.make`), the same shape as `QueueResource`. `ScheduledProcess` and the public
`ProcessSchedule` primitive are gone; everything they offered lives on the `Process` namespace.

**Removed**

- **`ScheduledProcess`** — the namespace **and** the `@nikscripts/effect-pm/ScheduledProcess`
  subpath. Define a process with **`Process.Tag`** and run it with **`Process.layer`** /
  **`Process.serve`** / **`Process.serveRemote`** / **`Process.configure`** (the engine
  `Process.make` / `Process.Service` are unchanged).
- **Public `ProcessSchedule`** — the schedule primitive is now internal. Its constructors, window
  builders, types, and the standalone schedule resource are re-exposed on the `Process` namespace.

**Migration**

| Old | New |
| --- | --- |
| `ScheduledProcess.Tag` / `layer` / `serve` / `serveRemote` / `configure` | `Process.Tag` / `Process.layer` / `Process.serve` / `Process.serveRemote` / `Process.configure` |
| `import … from "@nikscripts/effect-pm/ScheduledProcess"` | `import * as Process from "@nikscripts/effect-pm/Process"` |
| `ProcessSchedule.inMemory(entries?)` | `Process.scheduleInMemory(entries?)` |
| `ProcessSchedule.empty` | `Process.scheduleInMemory()` |
| `ProcessSchedule.alwaysArmed` | *(the default — omit `schedule` / `scheduleLayer`)* |
| `ProcessSchedule.define(build)` | `Process.scheduleDefine(build)` |
| `ProcessSchedule.at(...)` / `ProcessSchedule.window(...)` | `Process.at(...)` / `Process.window(...)` |
| `ProcessSchedule.fromStarts(dates)` | `dates.map((d) => Process.at(d))` |
| `ProcessScheduleEntry` / `ProcessScheduleService` / `ReconcileResult` / `ProcessScheduleControls` | `Process.ScheduleEntry` / `Process.ScheduleService` / `Process.ScheduleReconcileResult` / `Process.ScheduleControls` |

Prefer the pipeable combinator when a process owns its windows —
`Process.Tag<T>()("id").pipe(Process.schedule([Process.window(start, stop)]))` — or gate one or more
processes with a standalone **`Process.Schedule`** resource. Reading process status is now the
reactive `status` ref (`status.get` / `status.changes`), matching the queue.
