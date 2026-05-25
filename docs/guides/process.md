# Process

A **process** is a named unit of background work in effect-pm. You provide an `Effect` that runs to completion on each **repeat**; the library builds a long-lived **driver** (`process.effect`) that coordinates optional **polling** (how long to wait between repeats while allowed) and **schedule** (whether repeats are allowed at the current time). The same repeat body can also run once through `runImmediately()` without starting the driver.

**Scope of this guide:** how to **define** processes and wire polling/schedule. Processes are intended for **`ProcessGroup`** membership today: you register a `Process.make` value or `Process.Service` class, then **`group.start`** forks `process.effect`. Standalone `Effect.forkChild(process.effect)` is not the supported product path until **`Process.spawn`** exists.

This guide is separate from [`docs/rewrite/02-process.md`](../rewrite/02-process.md) and [`docs/PROCESS-API.md`](../PROCESS-API.md).

---

## Ways to define a process

The process **id** is always the first argument. After that you either pass the repeat **`effect`** plus optional **polling** / **schedule** layers in any order, or a single **config object** when you need a schedule initializer or `scheduleLayer`.

### `Process.make(id, effect, …layers?)`

Returns a **`Process<R>`** handle: `name`, `effect` (driver), `runImmediately()`, `getStatus()`. Prefer **`Process.Service`** for **`ProcessGroup`** entries; `make` is for one-off definitions and tests.

```typescript
import { Duration, Effect } from "effect";
import { Polling, Process, ProcessSchedule } from "@nikscripts/effect-pm";

const sync = Process.make(
  "@app/Sync",
  Effect.logInfo("sync"),
  Polling.spaced(Duration.seconds(30)),
  ProcessSchedule.inMemory([
    ProcessSchedule.window("match-1", startAt, stopAt),
  ]),
);

// polling and schedule can be swapped
const heartbeat = Process.make(
  "@app/Heartbeat",
  Effect.logInfo("tick"),
  ProcessSchedule.empty,
  Polling.spaced(Duration.seconds(5)),
);
```

**Benefits**

- Direct call site: effect first, then layers — no config object for the common case.
- Polling and schedule order does not matter.
- Plain value; easy to pass into `ProcessGroup.make`.

**Tradeoffs**

- Not a `ProcessGroup` entry by itself until registered on a group.
- Schedule **initializers** `(controls) => Effect` require the config-object form (below).

---

### `Process.make(id, config)`

Same driver as the positional form. Use when you need **`schedule: (controls) => Effect`**, **`scheduleLayer`**, or a single object for clarity.

```typescript
const gameSync = Process.make("@app/GameSync", {
  effect: Effect.logInfo("sync scores"),
  polling: Polling.spaced(Duration.seconds(15)),
  schedule: ProcessSchedule.empty,
});
```

**Benefits**

- Full `ProcessMakeOptions` surface (initializer, explicit `scheduleLayer`).

---

### `Process.Service<Self>()(id, effect, …layers?)` or `(id, config)`

Same overloads as **`Process.make`**, but returns a **`Context.Service`** subclass with `id`, `kind: "process"`, `process`, `layer`, and `tag`. **Preferred for typed `ProcessGroup` entries.**

```typescript
class Heartbeat extends Process.Service<Heartbeat>()(
  "@app/Heartbeat",
  Effect.logInfo("tick"),
  Polling.spaced(Duration.seconds(5)),
) {}
```

```typescript
class GameSync extends Process.Service<GameSync>()("@app/GameSync", {
  effect: Effect.logInfo("sync"),
  schedule: (controls) =>
    controls.set([ProcessSchedule.window("match", start, end)]),
  polling: Polling.spaced(Duration.seconds(15)),
}) {}
```

**Benefits**

- **Typed `ProcessGroup.make(id, [Heartbeat, MyQueue] as const)`** and stable contract ids.
- Layer-first app wiring (`Heartbeat.layer` merged at the group/app root).

**Tradeoffs**

- More ceremony than `make` for a one-off definition.

---

## Registering on a group

Typed groups take **process and queue service classes**:

```typescript
import { ProcessGroup } from "@nikscripts/effect-pm";

// class SyncProcess extends Process.Service<SyncProcess>()(...) {}

const group = yield* ProcessGroup.make("@app/Billing", [
  SyncProcess,
  EmailQueue,
] as const);

// Driver starts here — not at Process.make time
yield* group.start(SyncProcess);
```

See [`docs/SCHEDULE-AND-PROCESSGROUP.md`](../SCHEDULE-AND-PROCESSGROUP.md) for schedule vs `start`/`stop` semantics.

---

## Layer wiring

| Concern | On `make` / `Service` | Notes |
| --- | --- | --- |
| **`polling`** | `Polling.spaced`, `Polling.accelerating`, … | Merged into `process.effect`; excluded from fork-time `R` when inlined |
| **`schedule`** | `ProcessSchedule.*`, initializer, or `scheduleLayer` | Baked into `process.effect`; not replaceable by env alone |

Positional layers must be **effect-pm polling or schedule presets** (registered by those factories) so the runtime can distinguish them when order varies. Custom layers belong on the **config object** (`polling` / `schedule` / `scheduleLayer` fields).

---

## Choosing a form

| Goal | Prefer |
| --- | --- |
| Typed `ProcessGroup` entry | `Process.Service` |
| Schedule initializer or `scheduleLayer` | `Process.make(id, config)` or `Service` config overload |
| One-off definition or test | `Process.make(id, effect, …)` |
| Production default | `Process.Service` with inline polling + schedule |

---

## Configuration (`ProcessMakeOptions`)

Used by the **config-object** overload only.

| Field | Required | Role |
| --- | --- | --- |
| `effect` | yes | `Effect<void, E, R>` — one repeat. |
| `polling` | no | Cadence between repeats while **armed**. |
| `schedule` | no | Layer, initializer, or omit → **`ProcessSchedule.alwaysArmed`**. Use **`ProcessSchedule.empty`** to start disarmed. |
| `scheduleLayer` | no | Explicit schedule layer; wins over `schedule`. |

### Schedule defaults

| What you pass | Behavior |
| --- | --- |
| Omit `schedule` and `scheduleLayer` | `ProcessSchedule.alwaysArmed` |
| `schedule: ProcessSchedule.empty` | Disarmed until `set` / `add` / initializer |
| `schedule: ProcessSchedule.inMemory([...])` | Fixed initial entries |
| `schedule: (controls) => Effect` | Empty store; initializer at driver startup |

### Inside the running `effect`

| API | Purpose |
| --- | --- |
| `Process.currentScheduleId` | Optional id of the active schedule entry |
| `Process.scheduleControls` | `entries`, `set`, `add`, `clear` from the tick body |

---

## Handle API (definition time)

| Member | Description |
| --- | --- |
| `name` | Stable id (matches group contract / control routes). |
| `effect` | Schedule driver — forked by **`ProcessGroup.start`**, not by ad-hoc app code today. |
| `runImmediately()` | One tracked repeat via group **`runImmediately`** or local call; schedule need not be armed. |
| `getStatus(range?)` | Snapshot; uses **`ProcessStore`** when available. |

Provide **`ProcessStorage.layer`** or `layerProcessStore({ filename })` at the app/group root when you want execution history.

---

## Types

| Symbol | Meaning |
| --- | --- |
| `Process<R>` | Handle from `make`. |
| `ProcessMakeOptions<E, R>` | Config-object form. |
| `ProcessPollingInput` | Polling preset layer (positional). |
| `ProcessScheduleInput<R>` | Schedule layer or initializer. |
| `ProcessSupervisorRequirements<C>` | Inferred env for `process.effect` from config `C`. |
| `ProcessDefinition<Id, R>` | On `Process.Service` for groups. |
| `ProcessMakeInvalidLayerArgument` | Invalid positional layer (custom layer, duplicate, unknown). |

Merged `polling` / `schedule` on `make` are excluded from fork-time `R`.

---

## Related tools

| Tool | Role |
| --- | --- |
| **`Polling`** | Cadence between repeats. |
| **`ProcessSchedule`** | Armed/disarmed windows. |
| **`ProcessStore`** | Executions and lifecycle events. |
| **`ProcessGroup`** | Registers processes; **`start`** / **`stop`** / **`runImmediately`**. |
| **`ControlService`** | Localhost HTTP control. |
| **`ProcessManager`** | Typed remote client. |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/Process.ts` | `make`, `Service`, driver |
| `src/Polling.ts` | Cadence presets |
| `src/ProcessSchedule.ts` | Schedule presets |
| `src/ProcessStore.ts` | Analytics |
| `src/processLayerBrand.ts` | Preset layer discrimination for positional `make` |

See also [queue-resource.md](./queue-resource.md), [process-group.md](./process-group.md), [process-manager.md](./process-manager.md), [control-plane.md](./control-plane.md). Planned: **`Process.spawn`**.
