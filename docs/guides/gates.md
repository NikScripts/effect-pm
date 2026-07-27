{#gates title="Gate" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/gates>.
<!-- docs-site-link:end -->
# Gate

{.note}
**⚠️ Example only** — placeholder content that demonstrates the docs platform. **Not final**; to be replaced by Agent A. Do not treat as canonical.

A `Gate` wraps an effect behind a **concurrency gate** with typed input
and output. Where a queue drains items in the background, a gate is
called on demand — every caller waits for its result, but only so many run at
once.

## Define a gate

`payload` and `success` are schemas for the input and output. `concurrency`
caps how many bodies run in parallel; extra callers queue. Optional `rateLimit`
caps how many runs **start** per window (Effect `RateLimiter`) — orthogonal to
concurrency, same split as WorkPool.

``` ts
import { Gate } from "hyperlink-ts"
import { Duration, Effect, Schema } from "effect"

class Double extends Gate.Service<Double>()("app/Double", {
  payload: Schema.Number,
  success: Schema.Number,
  concurrency: 2,
  rateLimit: { limit: 100, window: Duration.seconds(1) },
  effect: (n) => Effect.succeed(n * 2),
}) {}
```

`rateLimit` is Effect’s `RateLimiter.consume` / `makeWithRateLimiter` options
(`limit`, `window`, `algorithm`, `onExceeded`, `tokens`, `key`, …) — not a
`RateLimiter` service handle. New upstream fields flow through. Provide
`RateLimiter.layerStoreRedis` (and optionally `RateLimiter.layer`) at the app
root for a fleet-wide budget; omit them and the gate Soft-builds an in-memory
limiter. Omitted `key` defaults to the gate id; omitted `onExceeded` defaults
to `"delay"`.

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
class Ping extends Gate.Service<Ping>()("app/Ping", {
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

## Run it live

A real `Gate` running in your browser — a slow `Double` (900ms,
concurrency 2). Hit **Run** to invoke it and watch `in-flight`; hit **Run ×5** and
you'll see only two run at once while the rest wait behind the gate. The live
values read straight off the service's `inFlight` subscribable — no dashboard widget.

``` run-resource
docs/Double
```
