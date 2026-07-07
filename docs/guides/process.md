# Process

A **managed process** is a named unit of background work: an `effect` that runs to completion on
each **repeat**, driven by a long-lived supervisor that coordinates **polling** (how long between
repeats while armed) and **schedule** (whether repeats are allowed now). It's a location-transparent
`Resource` — lifecycle + observability + schedule control behind one `Tag`.

`Process` is one module: the toolkit contract (`Process.Tag` / `Process.Schedule` / {@link ProcessTagOptions})
plus the engine (`Process.make` / `layer` / `serve`) over **`Polling`** and the internal schedule
primitive. A `Process.Tag`-only import pulls **zero** engine code; the engine loads when you call
`make` / `layer` / `serve`. See [../PROCESS-API.md](../PROCESS-API.md) and
[../handoffs/result-schema-and-rpc-validation.md](../handoffs/result-schema-and-rpc-validation.md).

## Define

```ts
import { Effect, Schema } from "effect";
import { Process } from "@nikscripts/effect-pm";

class LiveScores extends Process.Tag<LiveScores>()("nwsl/LiveScores") {}

const layer = Process.layer(LiveScores, {
  effect: pollLiveScores,
  // polling: …
  // captureLogs: true
});
```

- **`Process.layer(Tag, config)`** — local (auto-starts the driver).
- **`Process.serve(Tag, config)`** / **`serveRemote`** — host over RPC.
- **`Resource.client(Tag)`** — remote handle.

### Tag wire schemas (`success` / `error`)

Declare on the tag — positional or config object. Names match Effect `Resource.Method` slots
(`payload` / `success` / `error`). Process has no tag-level `payload` (the effect is in layer config).

```ts
const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

// void
class Health extends Process.Tag<Health>()("app/Health") {}

// value-returning
class Prices extends Process.Tag<Prices>()("app/Prices", Price) {}

// value + typed error channel
class PricesE extends Process.Tag<PricesE>()("app/Prices", Price, FetchErr) {}

// config object overload
class PricesCfg extends Process.Tag<PricesCfg>()("app/Prices", {
  success: Price,
  error: FetchErr,
}) {}
```

### Schedule (still pipeable)

```ts
class Matches extends Process.Tag<Matches>()("nwsl/Matches").pipe(
  Process.schedule([Process.window(gameStart, gameEnd)]),
) {}

class Ingest extends Process.Tag<Ingest>()("nwsl/Ingest").pipe(Process.schedule([])) {}
```

## Handle surface (`yield* Tag`)

- **Lifecycle:** `start`, `stop`, `runImmediately`.
- **Observe:** `status` (`status.get` / `status.changes`), `logs.live`, `logs.history`.
- **Schedule** (inline schedule only): `schedule.entries`, `schedule.set` / `add` / `clear`.
- **Result** (when `success` on tag): `result.get` / `result.changes` — `Option` until first success.

## Store

Register execution events on an app `Store.Service`:

```ts
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

const store = yield* Prices.store;
yield* store.record({ _tag: "RunCompleted", processId: Prices.key, /* … */, result: { … } });
const rows = yield* store.events({ limit: 10 });
```

On the **`Process.layer`** path, the engine auto-appends terminal runs. The layer includes a
**baked-in default in-memory store**; override with `Layer.provideMerge(AppStore.layerMemory)` when
you register the tag on an app store.

```ts
import { Layer } from "effect";
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

const live = Layer.provideMerge(
  AppStore.layerMemory,
  Process.layer(Prices, { effect: poll }),
);
```

## See also

- [toolkit-by-example.md](./toolkit-by-example.md)
- [../PROCESS-API.md](../PROCESS-API.md)
- [queue-resource.md](./queue-resource.md)
