# @nikscripts/effect-pm

## Unreleased

### Minor Changes

- Add `Process.scheduleControls` so schedule controls (`entries`, `set`, `add`, `clear`) are available inside running process effects, matching the controls passed to the `schedule` initializer.
- Add a new schedule-control example (`examples/schedule-control-surfaces.ts`) demonstrating three control surfaces: initializer controls, in-effect controls, and external controller fibers.
- Add two additional schedule-focused examples for organization and breadth: `examples/schedule-control-basics.ts` and `examples/schedule-control-db-sync.ts`.
- Expand schedule-focused tests to cover in-effect schedule controls and change-signal behavior.

## Current beta

### Minor Changes

- **Breaking — effect-first process runtime:** `Process.make` is centered on **`effect`**, with optional **`polling`** (`Polling.spaced`, `Polling.acceleratingScoped`, …) and **`schedule`** (`ProcessSchedule.alwaysArmed`, `ProcessSchedule.cronMatch`, `ProcessSchedule.fromArmedRef`, …) as **layers**. Compose at `make`, via **`Process.providePolling`** / **`Process.provideSchedule`**, or when providing **`process.effect`** at fork time.
- **`Polling` / `ProcessSchedule`:** context services and preset layers; **`ProcessDetails`** / **`ProcessGroup`** status expose **`armed`**, **`nextPollCadence`**, and schedule transition hints where available.
- **Supervisor:** **`start` / `startAll`** attaches schedule drivers; **disarm** pauses scheduled ticks while the fiber **waits** (hint-based or fallback idle sleep, **`Clock`**-aligned); **`cronMatch`** sampling uses the same **`Clock`**.
- **Resource modules:** `QueueResource`, `RunResource`, `HttpClientRunGate`, and `HttpApiResource` use the current class/service patterns documented in **`docs/RESOURCE-API.md`**.
- **Docs & examples:** **`docs/PROCESS-API.md`**, **`docs/RESOURCE-API.md`**, **`examples/queue-resource.ts`**, and the examples index describe the current beta surface.
