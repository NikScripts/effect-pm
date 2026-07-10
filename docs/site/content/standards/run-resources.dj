{#run-resources title="Run resources" appliesTo=all}
# Run resources

A `RunResource` wraps an effect behind a **concurrency gate** with typed input
and output. Where a queue drains items in the background, a run resource is
called on demand — every caller waits for its result, but only so many run at
once.

## Define a gate

`payload` and `success` are schemas for the input and output. `concurrency`
caps how many bodies run in parallel; extra callers queue.

``` ts
import { RunResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"

class Double extends RunResource.Service<Double>()("app/Double", {
  payload: Schema.Number,
  success: Schema.Number,
  concurrency: 2,
  effect: (n) => Effect.succeed(n * 2),
}) {}
```

## Call it

`run` invokes the gate. There's an instance form (after `yield*`) and a static
shortcut on the class.

``` ts
const program = Effect.gen(function* () {
  const dbl = yield* Double
  const a = yield* dbl.run(11)         // instance form => 22
  const b = yield* Double.run(21)      // static shortcut => 42

  const inFlight = yield* dbl.inFlight.get
})
```

## Unit form

A gate with no meaningful input takes `Schema.Void` and is called as `run()` —
useful for rate-limiting a side-effecting call.

``` ts
class Ping extends RunResource.Service<Ping>()("app/Ping", {
  payload: Schema.Void,
  success: Schema.Number,
  concurrency: 3,
  effect: () => Effect.map(Effect.clockWith((c) => c.currentTimeMillis), (t) => t),
}) {}

const startedAt = yield* Ping.run()
```

{.note}
The gate is the whole point: 15 parallel `run()` calls at `concurrency: 3` start
in batches of three. Callers see normal Effect results; the pool does the
throttling.
