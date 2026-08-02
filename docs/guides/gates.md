{#gates title="Gate" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/gates>.
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
// client.metrics.windows — windowed usage stream
```

| Nest field | Meaning |
|------------|---------|
| `remaining` / `resetAfter` / `exceeded` | Same limiter observation as ordinary Gates (dashboard/TUI surface these) |
| `usage` | Cumulative snapshot (`usage.get` / `usage.changes`) |
| `windows` | Windowed usage stream |

If an HttpApi **group id** equals the nest key, mint fails with
`Gate.MetricsKeyCollision`. Escape with const `metricsKey: "observe"` (typed
nest path). Whole-client `rateLimit` only in v1; omit `rateLimit.key` to inherit
the Tag id.

### Adaptive upstream 429 (opt-in)

Set `adaptive: true` (or `{ key }`) **with** `rateLimit`. Uses Effect
`adaptiveConsume` / `adaptiveFeedback` so 429 + `Retry-After` (delta-seconds)
trains a cooldown → learning → learned budget. Default off. Missing `rateLimit`
fails mint with `AdaptiveRequiresRateLimit`. Bucket key defaults to
`upstream:{host}` from the layer `baseUrl`.

```ts
class Demo extends Gate.HttpApiClient<Demo>()("@app/Demo", DemoApi, {
  rateLimit: { limit: 100, window: "1 hour" },
  adaptive: true,
}) {
  static readonly layer = Gate.httpApiClientLayer(Demo, {
    baseUrl: "https://api.example.com",
  })
}
```

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

Use the **same** `rateLimit.key` (or default service keys that you intend to
share) on every peer. Soft memory + distributed deploy = N× the limit (docs
warn; not fail-loud in v1).

**Local Redis:** `docker compose -f docker-compose.redis.yml up -d` (or
`redis-server`), then `REDIS_URL=redis://127.0.0.1:6379`. Live suites:
`test/rate-limit-redis.test.ts` (Gate + WorkPool + child-process peer) and
`test/effect-redis-stores.test.ts` (`Persistence.layerRedis` /
`PersistedQueue.layerStoreRedis`). Runnable form auto-detects Redis:
`pnpm exec tsx examples/gate/rate-limit-fleet.ts`.

## Reconfiguring (layer patches)

`Gate.configure(Tag, patch)` folds a config patch onto the gate layer **once at build**
— same model as WorkPool / Daemon (`Layer.provideMerge`). Not hot reload. See
[WorkPool → Reconfiguring](/docs/work-pools#reconfiguring-layer-patches).

## Lifecycle (pause / stop / live reconfig)

Every Gate participates in the shared **`Lifecycle`** protocol (same badge + verbs as
WorkPool / Daemon). The handle carries a `lifecycle` state badge, a `lifecycleEvents`
stream, and `start` / `pause` / `resume` / `stop` verbs, plus live `setConcurrency` /
`setRateLimit`.

```ts
const gate = yield* Double
yield* gate.pause     // admit new calls, but hold them (and any waiters) at the latch
yield* gate.resume    // release held callers
const state = yield* gate.lifecycle.get   // { _tag: "Running" | "Paused" | "Draining" | "Off" | "Idle" }
```

| Transition | Behavior |
|------------|----------|
| **pause** | New calls are admitted but latch-block; callers already **waiting** for a permit hold too. No `newOnly` knob. |
| **resume** | Latch opens; held callers proceed in order. |
| **stop** | New calls fail **`Gate.GateStopped`**; in-flight bodies **always finish**; awaits drain, then `Off`. |

Readiness follows the badge: `Idle` / `Running` / `Paused` stay dialable; `Draining` /
`Off` are not.

### `stopMode` — waiting callers at stop

`stopMode` decides what happens to calls already **waiting** for a permit (or a resume)
when `stop` is invoked. In-flight bodies always finish regardless.

| `stopMode` | Waiting callers |
|------------|-----------------|
| `"failWaiting"` (**default**) | Fail immediately with `Gate.GateStopped`. |
| `"finishWaiting"` | Keep their place — acquire a permit and run; only **new** admits are rejected. |

```ts
class Backup extends Gate.Service<Backup>()("app/Backup", {
  payload: Schema.String,
  concurrency: 1,
  stopMode: "finishWaiting",  // let queued callers drain on stop
  effect: (path) => archive(path),
}) {}

// `GateStopped` is always on the wire `run` error channel (alone when you omit
// `error`, else unioned with your declared errors). Typed catchTag works:
yield* gate.run("x").pipe(
  Effect.catchTag("GateStopped", () => Effect.logInfo("gate is stopped")),
)
```

### Live reconfiguration

`setConcurrency` / `setRateLimit` retune a **running** gate (each bumps
`status.configVersion` for observers):

```ts
yield* gate.setConcurrency(8)                 // Semaphore.resize + status.concurrency
yield* gate.setRateLimit({ limit: 50, window: Duration.seconds(1) })
yield* gate.setRateLimit(null)                // clear the limit entirely
```

`setConcurrency` resizes the underlying `Semaphore` — grows admit new permits at once;
shrinks apply as in-flight bodies release. `setRateLimit` swaps the consume policy for the
next call (`window` as a `Duration`); `null` removes rate limiting.

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

``` gate
docs/Double
```
