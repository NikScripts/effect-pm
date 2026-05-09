# Process Entry & State Shape

The full shape of a single process entry in `ProcessManagerState`. Everything here is a suggestion — field names, nesting, and groupings are all open for revision.

`ProcessManagerState` itself would be a record keyed by process id:

```ts
type ProcessManagerState = Record<string, ProcessEntry>
```

---

## Full ProcessEntry

```ts
interface ProcessEntry<R = never, S extends string = string> {

  // ─── Identity ───────────────────────────────────────────────────────────────
  id: string
  description?: string
  tags?: string[]
  createdAt: Date
  updatedAt: Date

  // ─── Status (CombinedStatus) ─────────────────────────────────────────────────
  // Derived from _internal.lifecycleStatus + _internal.effectRunning
  // Never set directly — always computed
  status:
    | { _tag: "Starting" }
    | { _tag: "Idle" }          // enabled, between ticks
    | { _tag: "Running" }       // enabled, mid-tick — derived from effectRunning
    | { _tag: "Disabled" }
    | { _tag: "Stopping" }
    | { _tag: "Stopped" }
    | { _tag: "Errored"; error: unknown }
    | { _tag: "Retrying"; attempt: number }

  // ─── Schedule ────────────────────────────────────────────────────────────────
  schedule: {
    available: S[]              // all schedule keys defined on this process
    active: S | null
    previous: S | null
    switchedAt: Date | null
    switchCount: number
    nextTickAt: Date | null     // estimated next execution time if calculable

    // Per-schedule runtime state — keyed by schedule name
    // ScheduleState<S>
    states: Record<S, {
      key: S
      description?: string
      activatedAt: Date | null      // when this schedule was last made active
      deactivatedAt: Date | null    // when it was last switched away from
      totalActiveTime: Duration | null
      activationCount: number       // how many times switched to
      executionCount: number        // how many ticks ran under this schedule
    }>
  }

  // ─── Effect Execution ────────────────────────────────────────────────────────
  effect: {
    running: boolean
    startedAt: Date | null          // current tick start
    lastCompletedAt: Date | null
    lastError: unknown | null
    lastErrorAt: Date | null
    runCount: number
    failureCount: number
    consecutiveFailures: number
    lastDuration: Duration | null
    averageDuration: Duration | null
  }

  // ─── Reconciler ──────────────────────────────────────────────────────────────
  // target — what the process should be doing
  // live — what is actually running right now
  // Reconciler converges live toward target
  target: {
    scheduleKey: S | null
    enabled: boolean
    metadata: Record<string, unknown>
  }
  live: {
    scheduleKey: S | null
    enabled: boolean
    metadata: Record<string, unknown>
  }

  // ─── User Metadata ───────────────────────────────────────────────────────────
  // Set by the effect via control object, observable, serializable
  metadata: Record<string, unknown>

  // ─── Process Lifetime ────────────────────────────────────────────────────────
  startedAt: Date | null
  stoppedAt: Date | null
  lastRestartAt: Date | null
  restartCount: number

  // ─── Handoff ─────────────────────────────────────────────────────────────────
  // Only present if handoff config was provided
  handoff?: {
    configured: boolean
    state:
      | { _tag: "Idle" }
      | { _tag: "Pending" }     // stop handler called, waiting for new instance
      | { _tag: "Complete" }
      | { _tag: "Failed"; error: unknown }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────
  // PM machinery — not serializable, not exposed publicly
  _internal: {
    effect: Effect<void, unknown, R>                          // the program
    fiber: Fiber<void, unknown> | null
    scope: Scope | null
    effectRunning: boolean                                    // reconciler gate
    processConfig: ProcessConfig<R, S>                       // original as-provided config
    activeSchedule: Schedule<unknown, unknown, unknown> | null

    // Static schedule definitions keyed by name — ScheduleConfig<S>
    scheduleConfigs: Record<S, {
      key: S
      schedule: Schedule<unknown, unknown, unknown>
      description?: string
    }>

    // LifecycleStatus — without Running, which lives in effectRunning
    lifecycleStatus:
      | { _tag: "Starting" }
      | { _tag: "Idle" }
      | { _tag: "Disabled" }
      | { _tag: "Stopping" }
      | { _tag: "Stopped" }
      | { _tag: "Errored"; error: unknown }
      | { _tag: "Retrying"; attempt: number }

    // Deploy-time handoff handlers — only present if handoff config provided
    handoffStop?: () => Effect<unknown>
    handoffStart?: (state: unknown) => Effect<void>
  }

}
```

---

## Store Event Types & ProcessStore Service

`ExecutionRecord`, `ScheduleSwitchEvent`, `LifecycleEvent`, `QueueItemMetadata`, and the full `ProcessStore` interface are defined in `07-process-store.md`. These flow into the store from PM internals and RP lifecycle hooks — the process entry shape does not hold them directly.
