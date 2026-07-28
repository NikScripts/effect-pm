{#daemons title="Daemon" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/daemons>.
<!-- docs-site-link:end -->
# Daemon

{.note}
**⚠️ Example only** — placeholder content that demonstrates the docs platform. **Not final**; to be replaced by Agent A. Do not treat as canonical.

A `Daemon` is long-running or scheduled work — a poller, a supervisor, a
periodic sync. You define it as a tag, then run it as a layer that ticks on a
schedule and records its execution history.

## Define and run

`Daemon.Tag` names the daemon and types its result. `Daemon.layer` runs it,
driving the `effect` on a `Polling` cadence.

``` ts
import * as Daemon from "hyperlink-ts/Daemon"
import { Polling } from "hyperlink-ts"
import { Duration, Effect, Schema } from "effect"

class Prices extends Daemon.Tag<Prices>()("app/Prices", {
  success: Schema.Number,
}) {}

const live = Daemon.layer(Prices, {
  effect: Effect.succeed(100_000),          // one tick's work
  polling: Polling.spaced(Duration.seconds(5)),
})
```

## Execution history

Run under `Daemon.layer` and each terminal tick is auto-appended to the Soft journal as a
typed event — `Started`, `Completed`, `Failed`, or `Interrupted` — which the dashboards read
back as a timeline. Default is in-memory; override with an app `Store.Service` that
registers `Daemon.store(Prices)` (see [Stores](/docs/stores)).

``` ts
import * as Store from "hyperlink-ts/Store"
import * as Daemon from "hyperlink-ts/Daemon"

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Daemon.store(Prices),
) {}

const store = yield* AppStore.at(Prices)
const events = yield* store.events()       // [{ _tag: "Completed", success, … }, …]
```

{.note}
`Daemon.layer` auto-writes history; a bare engine make without the layer does not.
Reach for the layer form when you want the run timeline recorded. There is no `ProcessStore`.

## Polling cadences

`Polling` shapes when a daemon ticks — fixed spacing, or accelerating toward an
event and relaxing afterward.

``` ts
Polling.spaced(Duration.seconds(30))       // steady 30s
Polling.accelerating({                     // fast near the action, slow when quiet
  fast: Duration.seconds(2),
  slow: Duration.minutes(5),
})
```
