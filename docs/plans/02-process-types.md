# Process Types & DX

## Overview

Three process variants built on a shared base config. The variants differ only in how scheduling is expressed. All share the same underlying reconciler and state model.

Nothing here is final — the DX options below are suggestions. Where multiple approaches are shown, each has tradeoffs worth considering.

---

## Shared Base Config

The base config is the current process config minus anything schedule-related. It covers the effect program, error handling, metadata, and lifecycle hooks.

```ts
interface BaseProcessConfig<R> {
  id: string
  effect: Effect<void, unknown, R>
  onError?: (error: unknown) => Effect<void>
  metadata?: Record<string, unknown>
  // ...other existing fields
}
```

Everything below extends this.

---

## Variant 1: Base Process

A process with no schedule. Runs once, or triggered externally via the PM's control API. Useful for one-shot jobs or processes driven entirely by external events.

```ts
interface BaseProcess<R> extends BaseProcessConfig<R> {
  // nothing added — no schedule means run-once or externally triggered
}
```

---

## Variant 2: Single Schedule Process

A process with one fixed schedule. The common case — most processes just need a schedule and never need to switch it at runtime.

**Option A — separate constructor**

```ts
const proc = ScheduledProcess.make({
  id: "health-check",
  effect: checkHealth,
  schedule: Schedule.fixed("30 seconds"),
})
```

**Option B — discriminated by presence of `schedule` field on the base make**

```ts
const proc = Process.make({
  id: "health-check",
  effect: checkHealth,
  schedule: Schedule.fixed("30 seconds"),
})
```

Option B keeps one entry point. Option A makes the variant explicit at the type level, which may be useful if the process types diverge further later.

---

## Variant 3: Multi-Schedule Process

A process that can switch between named schedules at runtime. The schedule names become the keys of a record, and one of them is the active schedule at any given time.

The `schedule` prop from the single-schedule variant doubles as the default here — rather than a separate `defaultSchedule` field, the process starts on `schedule` and can switch to any key in `schedules`.

### Config shape options

**Option A — `schedule` as default, `schedules` as additional named variants**

```ts
const proc = Process.make({
  id: "scores-poller",
  effect: pollScores,
  schedule: Schedule.fixed("5 minutes"),       // default — active on start
  schedules: {
    live: Schedule.fixed("10 seconds"),
    idle: Schedule.fixed("5 minutes"),
  },
})
```

The default schedule could be inlined or reference a key in `schedules`. If it references a key, switching back to it by name is a no-op (same schedule already active — see schedule switching doc).

**Option B — all schedules in `schedules`, with an explicit `defaultSchedule` key**

```ts
const proc = Process.make({
  id: "scores-poller",
  effect: pollScores,
  schedules: {
    live: Schedule.fixed("10 seconds"),
    idle: Schedule.fixed("5 minutes"),
  },
  defaultSchedule: "idle",
})
```

Slightly more explicit, but adds a field. Also requires validating that `defaultSchedule` is a key of `schedules` — straightforward with Effect Schema or a conditional type.

**Option C — flat record, first key is default**

```ts
const proc = Process.make({
  id: "scores-poller",
  effect: pollScores,
  schedules: {
    idle: Schedule.fixed("5 minutes"),   // first key = default
    live: Schedule.fixed("10 seconds"),
  },
})
```

Implicit convention. Simpler config, but "first key" ordering in a JS object is fragile and not obvious to users.

Option A or B are the safer choices. Option A has the ergonomic advantage that a single-schedule process and a multi-schedule process share the `schedule` field shape, making it easier to promote a process from one variant to the other.

---

## Schedule Config in Process Definition

When defining a multi-schedule process, each entry in `schedules` becomes a `ScheduleConfig` stored in `_internal.scheduleConfigs`. An optional `description` can be provided per schedule and surfaces in `schedule.states`:

```ts
// Option A with descriptions
Process.make({
  id: "scores-poller",
  effect: pollScores,
  schedule: Schedule.fixed("5 minutes"),
  schedules: {
    live: { schedule: Schedule.fixed("10 seconds"), description: "Active game polling" },
    idle: { schedule: Schedule.fixed("5 minutes"), description: "Background polling" },
  },
})

// Option B — plain Schedule values, no description
Process.make({
  id: "scores-poller",
  effect: pollScores,
  schedule: Schedule.fixed("5 minutes"),
  schedules: {
    live: Schedule.fixed("10 seconds"),
    idle: Schedule.fixed("5 minutes"),
  },
})
```

Whether descriptions are provided inline or as a wrapper object is a DX decision. Option A is more expressive, Option B is more concise for the common case.

---

The schedule key type should be derived from the config so typos are caught at compile time:

```ts
// If schedules: { live: ..., idle: ... }
// then switchSchedule only accepts "live" | "idle"
switchSchedule("offline") // TS error
```

This is achievable with a generic on the process config that captures the keys of `schedules`.

---

## Summary

| Variant | `schedule` | `schedules` | Use case |
|---|---|---|---|
| Base | — | — | One-shot, externally triggered |
| Single schedule | ✅ | — | Fixed cadence, no switching needed |
| Multi-schedule | ✅ (default) | ✅ | Runtime schedule switching |

The single-schedule variant is a degenerate case of multi-schedule — one schedule, never switched. Whether they share one constructor or have separate ones is a DX decision, not an architectural one.
