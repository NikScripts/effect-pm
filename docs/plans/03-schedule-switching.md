# Schedule Switching & Control API

## Overview

Multi-schedule processes can switch their active schedule at runtime. The switch is initiated from within the effect itself via a narrow control object passed in by the PM. The reconciler detects the change and handles the fiber lifecycle — the process fiber does not manage itself.

Nothing here is final. Multiple DX options are shown where there is genuine design space.

---

## Schedule Config vs Schedule State

Two distinct types are involved in schedule handling — both are suggestions:

**`ScheduleConfig`** lives in `_internal.scheduleConfigs`. It is the static definition the user provides — the actual `Schedule` value, the key, and an optional description. Never mutated at runtime.

**`ScheduleState`** lives in `schedule.states` on the public entry. It is the runtime state of a schedule on a specific process — when it was last active, how many times it has been used, execution count under that schedule. Updated by the PM as switches happen and ticks complete.

```ts
// static — lives in _internal
scheduleConfigs: Record<S, {
  key: S
  schedule: Schedule<unknown, unknown, unknown>
  description?: string
}>

// runtime — lives in schedule.states (public)
states: Record<S, {
  key: S
  description?: string
  activatedAt: Date | null
  deactivatedAt: Date | null
  totalActiveTime: Duration | null
  activationCount: number
  executionCount: number
}>
```

The `schedule.available` field on the entry holds all known schedule keys as a derived list.

---

1. The running effect calls `switchSchedule("live")` on the control object
2. The PM updates `target.activeScheduleKey` to `"live"`
3. The reconciler runs (immediately, or post-run if the effect is still executing)
4. The reconciler detects `target.activeScheduleKey !== live.activeScheduleKey`
5. The current fiber is stopped (safely — see safe stop section below)
6. The PM rebuilds the effect using the original program + the new schedule config
7. A new fiber is forked under a fresh scope
8. `live.activeScheduleKey` is updated to match `target`

The process fiber never touches its own fiber or scope. The PM owns all of that.

---

## Same-Schedule No-Op

Switching to the schedule that is already active is a no-op. The reconciler sees no diff between `target` and `live`, does nothing. No restart, no timer reset.

```ts
// Already on "live"
switchSchedule("live") // → reconciler: no diff → no action
```

---

## Safe Stop

Whether the current fiber can be interrupted immediately depends on `isRunningEffect`:

- **`isRunningEffect: false`** (waiting for next tick) → fiber can be interrupted immediately, no work in flight
- **`isRunningEffect: true`** (effect body is executing) → let it complete, reconcile post-run

This means a schedule switch requested mid-run takes effect after the current execution completes, not immediately. This is intentional — no partial-run interruption.

---

## Control Object Passed to the Effect

The effect receives a narrow control API — not full PM state, not a way to affect other processes. The surface is kept minimal for now, with better types deferred until the shape is clear from usage.

### Option A — passed as an argument to the effect function

```ts
const proc = Process.make({
  id: "scores-poller",
  effect: (ctrl) => Effect.gen(function* () {
    const isLive = yield* checkIfGameIsLive()

    if (isLive) {
      yield* ctrl.switchSchedule("live")
    } else {
      yield* ctrl.switchSchedule("idle")
    }

    yield* pollScores()
  }),
  schedule: Schedule.fixed("5 minutes"),
  schedules: {
    live: Schedule.fixed("10 seconds"),
    idle: Schedule.fixed("5 minutes"),
  },
})
```

Explicit, easy to follow, no ambient magic. The downside is that `effect` can no longer be a plain `Effect<void>` — it becomes a function, which is a more significant API change.

### Option B — control object provided via Effect service / context

```ts
const proc = Process.make({
  id: "scores-poller",
  effect: Effect.gen(function* () {
    const ctrl = yield* ProcessControl
    const isLive = yield* checkIfGameIsLive()
    yield* ctrl.switchSchedule("live")
    yield* pollScores()
  }),
  // ...schedules
})
```

Keeps `effect` as a plain `Effect`, consistent with how other Effect services are consumed. `ProcessControl` would be a service provided by the PM when running the effect. The downside is it requires knowing to `yield* ProcessControl` — less discoverable than an explicit argument.

### Option C — individual control effects provided via context (no control object)

```ts
const proc = Process.make({
  id: "scores-poller",
  effect: Effect.gen(function* () {
    const switchSchedule = yield* SwitchSchedule
    yield* switchSchedule("live")
    yield* pollScores()
  }),
  // ...schedules
})
```

More granular — only pull in what you need. Could work well if the control surface stays small, but gets noisy if it grows.

Option A or B are the most natural fits for Effect patterns. Option A is the most explicit and may be preferable during early development before the full control surface is known.

---

## Minimum Control Surface

Regardless of how it is delivered, the control object should expose at minimum:

```ts
interface ProcessControl<ScheduleKeys extends string> {
  // Switch active schedule by name — type-safe, keys derived from config
  switchSchedule: (key: ScheduleKeys) => Effect<void>

  // Sleep until a time or for a duration (replaces manual Effect.sleep in the effect body)
  sleepUntil: (time: Date) => Effect<void>
  sleepFor: (duration: Duration) => Effect<void>

  // Clear any pending sleep state
  clearSleep: () => Effect<void>

  // Optional: set metadata for observability
  setMetadata: (meta: Record<string, unknown>) => Effect<void>
}
```

`sleepUntil`, `sleepFor`, and `clearSleep` give the effect a way to schedule its next wake without depending on the schedule cadence. Useful for processes that want to sleep until a specific future event (e.g. a game start time) rather than a fixed interval.

---

## Type Safety for Schedule Keys

The `ScheduleKeys` generic should be inferred from the `schedules` record:

```ts
// Given schedules: { live: ..., idle: ... }
// switchSchedule accepts only "live" | "idle"
ctrl.switchSchedule("live")    // ✅
ctrl.switchSchedule("offline") // TS error
```

This requires the process config to be generic over the schedule keys, which threads through to the control object type. Worth the complexity — typos in schedule names are a real footgun at runtime.

---

## What Happens to the Old Fiber

When the reconciler stops a fiber for a schedule switch:

1. If `_internal.effectRunning` is false → interrupt immediately
2. Scope is closed — any resources acquired during the process's lifetime are released
3. A new scope is created
4. The PM retrieves the new schedule from `_internal.scheduleConfigs[newKey].schedule`
5. Reconstructs the scheduled effect: `original program + new Schedule`
6. New fiber forked under the new scope
7. `live.scheduleKey` updated to match `target.scheduleKey`
8. `schedule.states[newKey].activatedAt` and `schedule.states[oldKey].deactivatedAt` updated
9. Switch event written to `ProcessStore` if configured

The original program (`_internal.effect`) is stored in `_internal` and never mutated. Schedule switches only change which schedule wraps it.
