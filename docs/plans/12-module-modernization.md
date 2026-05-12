# 12 — Module modernization roadmap

**Status:** Plan

---

## Polling.ts — detailed plan

### Current state (245 lines, clean)

Already uses class pattern (`PollingTag`), clean architecture (wakeable sleep via Deferred), proper Effect patterns. Mostly needs documentation polish and potential new features.

### DX improvements

**1. Accept `Duration.Input` for spaced preset:**

```typescript
// Current:
Polling.spaced(Duration.minutes(5))

// Target:
Polling.spaced("5 minutes")
Polling.spaced(Duration.minutes(5))  // still works
```

**2. Simpler accelerating preset (DX sugar):**

```typescript
// Current lower-level form:
Polling.acceleratingScoped({ minIntervalMs: 1000, maxIntervalMs: 60000, decayK: 0.3 })

// Target human-friendly form:
Polling.accelerating({
  fastest: "1 second",
  slowest: "1 minute",
  decay: 0.3,         // how quickly it speeds up
  excitement: 1,      // multiplier (higher = faster acceleration)
})
```

**3. New preset: `jittered` (prevents thundering herd):**

```typescript
Polling.jittered("5 seconds", { jitter: 0.2 })
// Each tick: 5s ± 20% random jitter (4s–6s)
```

**4. New preset: `backoff` (for retry-like polling):**

```typescript
Polling.backoff({
  initial: "1 second",
  max: "30 seconds",
  factor: 2,
})
// 1s → 2s → 4s → 8s → 16s → 30s → 30s → ...
// resetCadence resets to initial
```

### Implementation changes

| Change | Effort |
|--------|--------|
| `Duration.Input` on `spaced` | Trivial |
| Rename accelerating config fields | Small |
| `jittered` preset | Small (wrap spaced with random offset) |
| `backoff` preset | Small (similar to accelerating but simpler math) |
| TSDoc with `@example` on each preset | Small |
| `strictBooleanExpressions` fixes | Trivial |

### Effect v4 to leverage

- `Duration.fromInput` — accept string durations everywhere
- Could use `Random` service for jitter (testable with `TestRandom`)

---

## ProcessSchedule.ts — detailed plan

### Current state (224 lines)

Already class pattern (`ProcessScheduleTag`), in-memory store with change signaling. Missing plan 10 features.

### DX improvements

**1. Required `id` on entries (plan 10):**

```typescript
// Current shape:
{ id: Option.some("match-123"), startAt: new Date(), stopAt: Option.none() }

// Target shape:
{ id: "match-123", startAt: Date, stopAt: Date | undefined }
```

This simplifies every interaction. `Option` was premature — id should always exist for real scheduling.

**2. Fluent entry builder:**

```typescript
// Current:
ProcessSchedule.window("game-123", gameStart, gameEnd)

// Target chainable form:
ProcessSchedule.entry("game-123")
  .startsAt(gameStart)
  .endsAt(gameEnd)
  .build()

// Or keep the simple shorthand too:
ProcessSchedule.at("game-123", gameStart)
ProcessSchedule.window("game-123", gameStart, gameEnd)
```

**3. Full CRUD + reconcile (plan 10):**

```typescript
const controls = yield* ProcessSchedule

// Read
const entries = yield* controls.entries
const entry = yield* controls.get("match-123")    // Option<Entry>
const exists = yield* controls.has("match-123")   // boolean

// Mutate
yield* controls.add(entry)
yield* controls.upsert(entry)                      // insert or update by id
yield* controls.remove("match-123")                // returns boolean (was it there?)
yield* controls.removeMany(["expired-1", "expired-2"]) // returns count removed
yield* controls.clear

// Sync from external source (DB, API)
const diff = yield* controls.reconcile(dbEntries)
// diff: { added: string[], updated: string[], removed: string[], unchanged: string[] }
```

**4. SubscriptionRef for reactive changes:**

Replace the manual `Ref<Deferred>` + notify pattern with `SubscriptionRef`:

```typescript
// Internal: SubscriptionRef<ReadonlyArray<ProcessScheduleEntry>>
// Consumers: yield* controls.changed (blocks until next mutation)
// Advanced: subscribe to the SubscriptionRef for streaming changes
```

**5. Duration-based time (consider):**

Entry `startAt`/`stopAt` could use epoch millis (number) instead of `Date` to avoid `globalDate` violations. Or use Effect's `DateTime`.

### Implementation changes

| Change | Effort |
|--------|--------|
| `id` required (breaking — drop Option) | Small |
| `get`/`has`/`upsert`/`remove`/`removeMany` | Medium |
| `reconcile` (diff + prune) | Medium |
| `SubscriptionRef` for change signal | Medium |
| Fluent entry builder | Small |
| `stopAt: Date \| undefined` (drop Option) | Small |
| TSDoc on all methods | Small |
| `Duration.Input` for time-based helpers | Small |

### Removal semantics (plan 10, critical)

When an entry is removed:
1. **Pending sleep** — fiber waiting for `startAt` is interrupted immediately
2. **Running instance** — checks `has(id)` before each poll tick; exits naturally if missing
3. **Completed** — no effect (only affects future reconcile)

This requires coordination with `Process.ts` (the supervisor that holds the sleeper/instance fibers).

---

## Process.ts — detailed plan

### Current state (951 lines, complex)

Trigger-driven supervisor. Spawns instances per schedule entry. Inner loop: poll → user effect → repeat while armed.

### DX improvements

**1. ProcessStore optional (`serviceOption`):**

```typescript
// Before: Process effect REQUIRES ProcessStore
readonly effect: Effect<void, never, R | ProcessStore>

// After: ProcessStore is optional — analytics silently skip when absent
readonly effect: Effect<void, never, R>
```

Execution tracking and `getStatus` degrade gracefully without ProcessStore.

**2. `Process.scheduleControls` accessor (plan 10):**

```typescript
const proc = Process.make({
  name: "sports-poller",
  effect: Effect.gen(function*() {
    const controls = yield* Process.scheduleControls
    const latest = yield* loadFromDb()
    yield* controls.reconcile(latest)
    // ... business logic
  }),
})
```

**3. Effect.fn for key operations:**

```typescript
// Named traces:
const spawnInstance = Effect.fn("Process.spawnInstance")(function*(...) { ... })
const trackedProgram = Effect.fn("Process.trackedProgram")(function*(...) { ... })
const reconcileSchedules = Effect.fn("Process.reconcileSchedules")(function*(...) { ... })
```

**4. FiberMap for instance management:**

Replace manual `MutableRef<Map<string, Fiber>>` with Effect's `FiberMap`:

```typescript
const instances = yield* FiberMap.make<string, void>()
// Key: entry id, Value: running instance fiber
// Auto-cleanup on scope close, keyed interrupt for removal
```

**5. Structured logging:**

```typescript
Effect.annotateLogs({
  "process.name": name,
  "process.entry": entryId,
  "process.instance": instanceId,
})
```

### Effect v4 to leverage

| Feature | Replaces | Benefit |
|---------|----------|---------|
| `FiberMap` | `MutableRef<Map<string, Fiber>>` | Keyed management, auto-cleanup |
| `Effect.fn` | Anonymous generators | Named traces in spans |
| `Effect.serviceOption` | Hard `ProcessStore` requirement | Optional analytics |
| `Effect.annotateLogs` | No structured context | Per-process, per-entry, per-instance annotations |
| `SubscriptionRef` | `changed` Deferred polling | Reactive schedule propagation |

---

## ProcessGroup.ts — detailed plan

### Current state (916 lines, orchestration)

Owns process lifecycle + queue access + control server. Hard ProcessStore requirement.

### DX improvements

**1. ProcessStore optional:**

Same `serviceOption` pattern. Lifecycle events (Started, Stopped, Restarted) are recorded when ProcessStore is available, silently skipped when absent.

**2. FiberMap for process fibers:**

```typescript
const processFibers = yield* FiberMap.make<string, void>()
// Key: process name, Value: supervisor fiber
// start → FiberMap.run(processFibers, name, supervisorEffect)
// stop → FiberMap.interrupt(processFibers, name)
```

**3. Effect.fn on control methods:**

```typescript
const start = Effect.fn("ProcessGroup.start")(function*(name: string) { ... })
const stop = Effect.fn("ProcessGroup.stop")(function*(name: string) { ... })
```

**4. Richer status API:**

```typescript
// Current: processStatus returns ProcessDetails
// New: also expose group-level aggregate
yield* group.status  // { processes: [...], queues: [...], uptime, health }
```

**5. Health check:**

```typescript
yield* group.health
// { healthy: boolean, processes: { running: 3, stopped: 1 }, queues: { active: 2, paused: 0 } }
```

---

## ControlService.ts — detailed plan

### Current state (548 lines, raw node:http)

Uses `node:http` directly (violates `nodeBuiltinImport`). Manual JSON parsing. Single POST endpoint.

### Target: Effect HttpServer

```typescript
import { HttpRouter, HttpServer } from "@effect/platform-node"

const controlRouter = HttpRouter.empty.pipe(
  HttpRouter.post("/control", controlHandler),
  HttpRouter.get("/health", healthHandler),
  HttpRouter.get("/events", sseEventsHandler),  // streaming
)
```

### DX improvements

**1. Schema-validated requests:**

```typescript
const ControlRequest = Schema.Union(
  Schema.Struct({ command: Schema.Literal("start"), name: Schema.String }),
  Schema.Struct({ command: Schema.Literal("stop"), name: Schema.String }),
  Schema.Struct({ command: Schema.Literal("ls") }),
  // ...
)
```

**2. RESTful routes (not just POST /control):**

```
GET  /processes              → list processes
GET  /processes/:name        → process status
POST /processes/:name/start  → start
POST /processes/:name/stop   → stop
POST /processes/:name/restart → restart
GET  /queues                 → list queues
GET  /queues/:name           → queue status
POST /queues/:name/pause     → pause
POST /queues/:name/resume    → resume
POST /queues/:name/clear     → clear
GET  /health                 → health check
GET  /events                 → SSE stream of ProcessStore events
```

**3. Unix socket transport (from earlier discussion):**

```typescript
// Bind to socket file instead of TCP port
group.serve({ socket: `/tmp/effect-pm-${groupName}.sock` })
// CLI auto-discovers socket by group name
```

**4. SSE streaming for live updates:**

```typescript
// GET /events → Server-Sent Events
// Client receives real-time ProcessStore events as they happen
```

---

## New features to add across modules

### Process: `onTick` / `onError` hooks (like QueueResource's hooks)

```typescript
Process.make({
  name: "my-proc",
  effect: ...,
  onTick: (duration) => metrics.histogram("tick_duration", duration),
  onError: (error) => alerting.notify(error),
})
```

### ProcessGroup: `addProcess` / `removeProcess` at runtime

```typescript
yield* group.addProcess(newProcess)  // hot-add without restart
yield* group.removeProcess("stale-proc")  // document runtime removal clearly
```

### Polling: `Polling.cron` (schedule-aware cadence)

```typescript
// Poll at cron-defined intervals (not just fixed/accelerating)
Polling.cron("*/5 * * * *")  // every 5 minutes, aligned to clock
```

### ProcessSchedule: `ProcessSchedule.fromCron`

```typescript
// Generate schedule entries from a cron expression
ProcessSchedule.fromCron("0 2 * * *", { count: 7 })
// → next 7 occurrences of "daily at 2am" as entries
```

---

## Implementation order

1. **Polling** — Duration.Input, new presets (jittered, backoff), TSDoc
2. **ProcessSchedule** — plan 10 (id required, CRUD, reconcile, SubscriptionRef)
3. **Process** — serviceOption, FiberMap, Effect.fn, schedule controls accessor
4. **ProcessGroup** — serviceOption, FiberMap, Effect.fn, health
5. **ControlService** — Effect HttpServer, Schema, RESTful routes, SSE, Unix socket
