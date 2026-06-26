# ScheduledProcess

A **scheduled process** is a named unit of background work: an `effect` that runs to completion on
each **repeat**, driven by a long-lived supervisor that coordinates **polling** (how long between
repeats while armed) and **schedule** (whether repeats are allowed now). It's a location-transparent
`Resource` — lifecycle + observability + schedule control behind one `Tag`.

`ScheduledProcess` wraps the lower-level **`Process`** engine + **`Polling`** + **`ProcessSchedule`**
(see [../PROCESS-API.md](../PROCESS-API.md) for those spec tables).

## Define

```ts
import { Effect } from "effect";
import { ScheduledProcess } from "@nikscripts/effect-pm";

class LiveScores extends ScheduledProcess.Tag<LiveScores>()("nwsl/LiveScores") {}

const layer = ScheduledProcess.layer(LiveScores, {
  effect: pollLiveScores,        // one repeat body
  // polling: …                  // cadence between repeats (Polling layer)
  // schedule: …                 // when it's armed (ProcessSchedule); default alwaysArmed
  // captureLogs: true           // feed `logs` / `logHistory`
});
```

- **`ScheduledProcess.layer(Tag, config)`** — local (auto-starts the driver).
- **`ScheduledProcess.serveHttp(Tag, config)`** / **`server`** — host over RPC.
- **`Resource.client(Tag)`** — remote handle.

Default schedule is `ProcessSchedule.alwaysArmed` (runs immediately); pass
`schedule: ProcessSchedule.empty` to start disarmed and drive it via the schedule verbs /
`runImmediately`.

## Handle surface (`yield* Tag`)

- **Lifecycle:** `start`, `stop`, `runImmediately` (one tracked run even when disarmed).
- **Observe:** `statusNow` / `status` (armed, activeInstances, run metrics, next transitions),
  `logs` (live) + `logHistory` (durable; needs `captureLogs` + a `HistoryStore`).
- **Schedule:** `schedule` (read), `setSchedule` / `addSchedule` / `clearSchedule`.

For richer schedule control (CRUD + `reconcile` + a `changes` stream) as its own resource, use
**`ProcessScheduleResource`** over the same backing schedule.

## See also

- [toolkit-by-example.md](./toolkit-by-example.md) — full patterns (local, remote, groups, UI)
- [../PROCESS-API.md](../PROCESS-API.md) — `Process` / `Polling` / `ProcessSchedule` spec tables
- [queue-resource.md](./queue-resource.md) — the queue resource
