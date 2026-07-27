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

`rateLimit` is Effect’s `RateLimiter.consume` options
(`limit`, `window`, `algorithm`, `onExceeded`, `tokens`, `key`, …) — not a
`RateLimiter` service handle. New upstream fields flow through. Omitted `key`
defaults to the gate id; omitted `onExceeded` defaults to `"delay"`.

## Metrics nest (limiter observation)

Every Gate Tag/Service handle exposes a flat **`metrics`** nest with live
limiter fields. Values update when `rateLimit` is set; otherwise they stay idle
zeros.

| Field | Meaning |
|-------|---------|
| `metrics.remaining` | Tokens left after the last consume |
| `metrics.resetAfter` | Milliseconds until the window fully resets |
| `metrics.exceeded` | Count of delay/reject events since the gate built |

Stable discovery metadata is on the **Tag**, not under the nest path:

```ts
Gate.metricsKeyOf(Double)    // "metrics" (v1 nest path)
Gate.rateLimitKeyOf(Double)  // bucket key when rateLimit was declared at mint
```

```ts
const gate = yield* Double
const remaining = yield* gate.metrics.remaining.get
```

Ordinary Gates stay limiter-only. HttpApi clients use the same nest name with
extra fields — see **HttpApiClient** below.

## HttpApiClient

`Gate.HttpApiClient` is a Hyperlink Tag: local HttpApi routes plus a wire
`metrics` nest (limiter fields + absorbed usage). Pair with an app-owned layer
— no baked `.layer` on the Tag.

```ts
class Demo extends Gate.HttpApiClient<Demo>()("@app/Demo", DemoApi, {
  concurrency: 2,
  rateLimit: { limit: 100, window: "1 second" },
}) {
  static readonly layer = Gate.httpApiClientLayer(Demo, {
    baseUrl: "https://api.example.com",
    transformClient: Gate.acceptJson,
  })
}

const client = yield* Demo
yield* client.posts.getPost({ params: { id: "1" } })
const snap = yield* client.metrics.usage.get
// client.metrics.windows — windowed usage stream (was ApiMetrics.metrics)
```

| Nest field | Meaning |
|------------|---------|
| `remaining` / `resetAfter` / `exceeded` | Same limiter observation as ordinary Gates |
| `usage` | Cumulative snapshot (`usage.get` / `usage.changes`) |
| `windows` | Windowed usage stream (absorbed former ApiMetrics stream) |

If an HttpApi **group id** equals the nest key, mint fails with
`Gate.MetricsKeyCollision`. Escape with const `metricsKey: "observe"` (typed
nest path). Whole-client `rateLimit` only in v1; omit `rateLimit.key` to inherit
the Tag id.

## Fleet rate limiting

`concurrency` is always **in-process** (Semaphore). Fleet-wide budgets need a
**shared** `RateLimiterStore`:

| Composition | Budget |
|-------------|--------|
| Omit store (Soft memory) | Per Node / per Gate scope — fine for single-node |
| Provide `RateLimiter.layerStoreRedis` at the app root | Shared across every Gate that sees that store |
| Provide `RateLimiter.layerStoreMemory` in tests | Same presence-driven path; simulates Redis |

``` ts
import * as NodeRedis from "@effect/platform-node/NodeRedis"
import { Layer } from "effect"
import { RateLimiter } from "effect/unstable/persistence/RateLimiter"

// Fleet root — one Redis store for every Gate / WorkPool with rateLimit
const FleetLive = Layer.mergeAll(
  EastGate.layer,
  WestGate.layer,
).pipe(
  Layer.provide(RateLimiter.layerStoreRedis({ prefix: "fleet:" })),
  Layer.provide(NodeRedis.layer({ host: "127.0.0.1", port: 6379 })),
)
```

Use the **same** `rateLimit.key` (or default resource ids that you intend to
share) on every peer. Soft memory + distributed deploy = N× the limit (docs
warn; not fail-loud in v1).

**Local Redis:** `docker compose -f docker-compose.redis.yml up -d` (or
`redis-server`), then `REDIS_URL=redis://127.0.0.1:6379`. Live suites:
`test/rate-limit-redis.test.ts` (Gate + WorkPool + child-process peer) and
`test/effect-redis-stores.test.ts` (`Persistence.layerRedis` /
`PersistedQueue.layerStoreRedis`). Runnable form auto-detects Redis:
`pnpm exec tsx examples/forms/hyperlink/gate-rate-limit-fleet.ts`.

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
