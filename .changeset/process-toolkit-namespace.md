---
"hyperlink-ts": minor
---

`Process` is now a single Effect **module namespace** (`export * as Process`) that carries both the supervisor engine and the location-transparent `Resource` toolkit — the same shape as `QueueResource`. Member access tree-shakes: a `Process.Tag`-only consumer pulls no engine code; `make` / `layer` / `serve` pull the engine only when referenced.

**New (Resource toolkit, additive):**

- **`Process.Tag`** — define a managed process as a toolkit resource (observation + lifecycle: `status` reactive ref, `start` / `stop` / `runImmediately`, `logs.live` / `logs.history`). Driven locally or remotely over RPC through the same `yield* Tag` surface.
- **`Process.schedule(...)`** (pipeable) — attach a schedule. Inline windows (`Process.schedule([Process.window(...)])`) give the process its own `schedule` verb group (`entries` / `set` / `add` / `clear`); an external `Process.Schedule` resource gates it with no added verbs.
- **`Process.result(Schema)`** (pipeable) — mark a process value-returning; it gains a reactive `result` holding the latest success (an `Option`, absent until the first run).
- **`Process.Schedule`** — a standalone, reusable, RPC-capable window manager (full CRUD) that can gate one or more processes.
- **`Process.window` / `Process.at`** — declarative schedule-window templates (id optional).
- **`Process.layer` / `Process.serve` / `Process.serveRemote` / `Process.configure`** — run a process resource locally, serve it (with/without the local instance), or fold a per-environment config patch. **`Process.scheduleLayer` / `Process.scheduleServe`** do the same for a standalone `Process.Schedule`.

**Compatibility:** the engine surface is unchanged and stays under the same namespace — `Process.make`, `Process.Service`, `Process.currentScheduleId`, `Process.scheduleControls`, `Process.Errors` all keep working (barrel and `import * as Process` usage is unaffected). The only behavioral change is the export mechanism: a named-value import of the old namespace object (`import { Process } from "@nikscripts/effect-pm/Process"`) must become `import * as Process from "@nikscripts/effect-pm/Process"`.
