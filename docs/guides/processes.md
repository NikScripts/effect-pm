{#processes title="Processes" appliesTo=all}
# Processes

{.note}
**⚠️ Example only** — placeholder content that demonstrates the docs platform. **Not final**; to be replaced by Agent A. Do not treat as canonical.

A `Process` is long-running or scheduled work — a poller, a supervisor, a
periodic sync. You define it as a tag, then run it as a layer that ticks on a
schedule and records its execution history.

## Define and run

`Process.Tag` names the process and types its result. `Process.layer` runs it,
driving the `effect` on a `Polling` cadence.

``` ts
import * as Process from "@nikscripts/effect-pm/Process"
import { Polling } from "@nikscripts/effect-pm"
import { Duration, Effect, Schema } from "effect"

class Prices extends Process.Tag<Prices>()("app/Prices", {
  success: Schema.Number,
}) {}

const live = Process.layer(Prices, {
  effect: Effect.succeed(100_000),          // one tick's work
  polling: Polling.spaced(Duration.seconds(5)),
})
```

## Execution history

Run under `Process.layer` and each terminal tick is auto-appended to the
process store as a typed event — `Started`, `Completed`, `Failed`, or
`Interrupted` — which the dashboards read back as a timeline.

``` ts
import * as Store from "@nikscripts/effect-pm/Store"

const store = yield* MyStore.at(Prices)
const events = yield* store.events()       // [{ _tag: "Completed", success, … }, …]
```

{.note}
`Process.layer` auto-writes history; `Process.make` does not. Reach for the
layer form when you want the run timeline recorded.

## Polling cadences

`Polling` shapes when a process ticks — fixed spacing, or accelerating toward an
event and relaxing afterward.

``` ts
Polling.spaced(Duration.seconds(30))       // steady 30s
Polling.accelerating({                     // fast near the action, slow when quiet
  fast: Duration.seconds(2),
  slow: Duration.minutes(5),
})
```
