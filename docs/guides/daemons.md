{#daemons title="Daemon" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/daemons>.
<!-- docs-site-link:end -->
# Daemon

{.draft}
**Draft** — ported from the pre-site corpus; tip-check before treating as SSOT.

A **Daemon** is a named unit of background work: an `effect` that runs to completion on each
**repeat**, driven by a long-lived supervisor that coordinates **polling** (how long between
repeats while armed) and **schedule** (whether repeats are allowed now). It is a location-transparent
Hyperlink Service — lifecycle, observation, and schedule control behind one Tag.

`Daemon` is one module: the toolkit contract (`Daemon.Tag` / `Daemon.Schedule`) plus the engine
(`Daemon.make` / `layer` / `serve`) over `Polling` and the schedule primitive. A Tag-only import
pulls **zero** engine code; the engine loads when you call `make` / `layer` / `serve`.

## Choose your entry point

| You want | Use | Execution history |
|----------|-----|-------------------|
| Embed the supervisor in your own layer graph | `Daemon.make` | **Off** — no auto-append; call `store.record` or use `layer` |
| A toolkit HyperService (local or RPC) | `Daemon.layer` | **On** — terminal runs append via `Daemon.store(tag)` |
| HTTP/RPC host without local instance | `Daemon.serveRemote` | **On** (same as `layer`) |
| HTTP/RPC host with local instance | `Daemon.serve` | **On** (same as `layer`) |

`Daemon.make` is for forms, tests, and custom composition. Apps that need run history should use
`Daemon.layer` (or register `Daemon.store(tag)` and append manually).

## Define a tag

``` ts
import { Duration, Effect } from "effect"
import * as Daemon from "hyperlink-ts/Daemon"
import { Polling } from "hyperlink-ts"

declare const pollLiveScores: Effect.Effect<void>

class LiveScores extends Daemon.Tag<LiveScores>()("nwsl/LiveScores") {}

const layer = Daemon.layer(LiveScores, {
  effect: pollLiveScores,
  polling: Polling.spaced(Duration.seconds(30)),
})
```

Provide `Logs.layer` on the Node stack for durable logs; read with `Hyperlink.logs(LiveScores)` —
see [Logs](/docs/logs).

- **`Daemon.layer(Tag, config)`** — local driver (auto-starts).
- **`Daemon.serve(Tag, config)`** / **`serveRemote`** — host over RPC.
- **`Hyperlink.client(Tag)`** — remote handle.

### Tag wire schemas (`success` / `error`)

Declare on the tag via the config object (names match Effect `Hyperlink.Method` slots). Daemon has
**no** tag-level `payload` — the tick body lives in layer config.

``` ts
import { Schema } from "effect"
import * as Daemon from "hyperlink-ts/Daemon"

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number })
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number })

// void — no live `result` ref
class Health extends Daemon.Tag<Health>()("app/Health") {}

// value-returning — gains `result.get` / `result.changes` (Option until first success)
class Prices extends Daemon.Tag<Prices>()("app/Prices", { success: Price }) {}

// value + typed fail channel on store rows
class PricesE extends Daemon.Tag<PricesE>()("app/Prices", {
  success: Price,
  error: FetchErr,
}) {}
```

`success` and `error` on the tag drive the **execution store** wire (`Completed.success`,
`Failed.error`) and live `result` when `success` is set. They do **not** change Daemon RPC error
responses today — lifecycle RPC methods remain void. Failures from poll ticks are persisted via
`Daemon.store`; remote clients observe them through store reads or logs.

### Schedule (pipeable)

``` ts
import * as Daemon from "hyperlink-ts/Daemon"

declare const gameStart: Date
declare const gameEnd: Date

class Matches extends Daemon.Tag<Matches>()("nwsl/Matches").pipe(
  Daemon.schedule([Daemon.window(gameStart, gameEnd)]),
) {}

// empty inline schedule — disarmed until `schedule.add` / `set`
class Ingest extends Daemon.Tag<Ingest>()("nwsl/Ingest").pipe(Daemon.schedule([])) {}
```

## Handle surface (`yield* Tag`)

- **Lifecycle:** `start`, `stop`, `run` (typed success/error on RPC when stamped).
- **Observe:** `status` (`status.get` / `status.changes`). Logs via `Hyperlink.logs(Tag)` — not on
  the process handle.
- **Schedule** (inline schedule only): `schedule.entries`, `schedule.set` / `add` / `clear`.
- **Result** (when `success` on tag): `result.get` / `result.changes` — `Option` until first success.

## Execution store (`Daemon.store`)

Register the built-in execution contract on an app `Store.Service`. Rows are an append-only event
union — the same shape the toolkit layer persists on terminal runs. Composition recipe:
[Stores](/docs/stores).

``` ts
import * as Store from "hyperlink-ts/Store"
import * as Daemon from "hyperlink-ts/Daemon"
import { Effect } from "effect"

class Prices extends Daemon.Tag<Prices>()("app/Prices") {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Daemon.store(Prices),
) {}

const program = Effect.gen(function* () {
  const store = yield* AppStore.at(Prices)
  yield* store.record({
    _tag: "Completed",
    key: Prices.key,
    scheduleKey: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    isStartupRun: true,
  })
  return yield* store.events({ limit: 10 })
})
```

### Wire shape (locked)

| Field | Rule |
|-------|------|
| `_tag` | `Started` \| `Completed` \| `Failed` \| `Interrupted` |
| `key` | HyperService key (the Tag's `.key`) |
| `success` | On `Completed` **only if** the tag stamps `success` |
| `error` | Always on `Failed`; typed when the tag stamps `error`, otherwise `string` |
| `isStartupRun` | `true` when no prior execution row exists for this process |

On `Daemon.layer` / `serve` / `serveRemote`, finished runs append automatically. Soft-default
in-memory storage applies unless you override with an app store (see [Stores](/docs/stores)).
`Daemon.make` does **not** auto-append.

## `Daemon.make` (embeddable supervisor)

``` ts
import * as Daemon from "hyperlink-ts/Daemon"
import { Polling } from "hyperlink-ts"
import { Duration, Effect } from "effect"

declare const tick: Effect.Effect<void>

const proc = Daemon.make("examples/polling-demo", {
  effect: tick,
  polling: Polling.spaced(Duration.millis(50)),
})

// Embed: fork `proc.effect` under your own Layer / Scope (polling/schedule already merged).
```

## Polling cadences

`Polling` shapes when a daemon ticks — fixed spacing, or accelerating toward an event and relaxing
afterward.

``` ts
import { Polling } from "hyperlink-ts"
import { Duration } from "effect"

Polling.spaced(Duration.seconds(30))
Polling.accelerating({
  fast: Duration.seconds(2),
  slow: Duration.minutes(5),
})
```

## Examples in this repo

| Path | Focus |
|------|--------|
| [`examples/forms/schedule/`](../../examples/forms/schedule/) | Windows, `at`, controls, `scheduleDefine` |
| [`examples/forms/polling/`](../../examples/forms/polling/) | Spaced / accelerating cadence, `TestClock` |
| [`examples/forms/daemon-store/`](../../examples/forms/daemon-store/) | `Daemon.layer` + `Daemon.store` + typed errors |

## See also

- [Stores](/docs/stores) — Soft storage composition
- [WorkPool](/docs/work-pools) — sibling included HyperService (queues)
- [API Reference](/api/hyperlink-ts) — generated tables
- Cutover history: [`docs/handoffs/store-cutover-daemon.md`](../handoffs/store-cutover-daemon.md)
