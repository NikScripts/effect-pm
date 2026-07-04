# Process

A **managed process** is a named unit of background work: an `effect` that runs to completion on
each **repeat**, driven by a long-lived supervisor that coordinates **polling** (how long between
repeats while armed) and **schedule** (whether repeats are allowed now). It's a location-transparent
`Resource` — lifecycle + observability + schedule control behind one `Tag`.

`Process` is one module: the toolkit contract (`Process.Tag` / `Process.Schedule` / the pipeable
combinators) plus the engine (`Process.make` / `layer` / `serve`) over **`Polling`** and the internal
schedule primitive. A `Process.Tag`-only import pulls **zero** engine code (proven by the tree-shake
check); the engine loads only when you call `make` / `layer` / `serve`. See
[../PROCESS-API.md](../PROCESS-API.md) for the spec tables.

## Define

```ts
import { Effect } from "effect";
import { Process } from "@nikscripts/effect-pm";

class LiveScores extends Process.Tag<LiveScores>()("nwsl/LiveScores") {}

const layer = Process.layer(LiveScores, {
  effect: pollLiveScores, // one repeat body
  // polling: …           // cadence between repeats (Polling layer)
  // captureLogs: true     // feed `logs.live` / `logs.history`
});
```

- **`Process.layer(Tag, config)`** — local (auto-starts the driver).
- **`Process.serve(Tag, config)`** / **`serveRemote`** — host over RPC (compose with `Resource.httpServer`).
- **`Resource.client(Tag)`** — remote handle.

A base `Process.Tag` is **always-armed** (runs immediately). Add a **schedule** at definition time
with the pipeable combinator:

```ts
// inline windows — the tag also gains the `schedule` verb group (read + CRUD)
class Matches extends Process.Tag<Matches>()("nwsl/Matches").pipe(
  Process.schedule([
    Process.window(gameStart, gameEnd),        // nameless window
    Process.window("playoffs", start, stop),   // named window
  ]),
) {}

// seed empty (disarmed) — arm it later via the `schedule` verbs or `runImmediately`
class Ingest extends Process.Tag<Ingest>()("nwsl/Ingest").pipe(Process.schedule([])) {}
```

A process that returns a value exposes it reactively — add `Process.result(Schema)`:

```ts
class Price extends Process.Tag<Price>()("app/Price").pipe(Process.result(Schema.Number)) {}
// yield* (yield* Price).result.get  →  Option<number> (None before the first successful run)
```

## Handle surface (`yield* Tag`)

- **Lifecycle:** `start`, `stop`, `runImmediately` (one tracked run even when disarmed).
- **Observe:** `status` — a reactive `ref` (`status.get` reads the snapshot: `supervising`, `armed`,
  `activeInstances`, run metrics, next transitions; `status.changes` streams it) — plus `logs.live`
  and `logs.history` (durable; needs `captureLogs` + a `HistoryStore`).
- **Schedule** (only on a tag given `Process.schedule(…)`): `schedule.entries` (a reactive `ref`),
  `schedule.set` / `schedule.add` / `schedule.clear`.
- **Result** (only on a tag given `Process.result(…)`): `result` (a reactive `ref`; `Option` until the
  first successful run).

> Over RPC a `ref`'s `.get` reads a client-side cache fed by its `.changes` stream, so a
> mutate-then-immediately-read is eventually consistent — observe `.changes` (with a predicate) to
> see a control-plane effect land, exactly as the queue does.

## Standalone schedule resource

For a reusable window manager that **one or more** processes can be gated by — with full CRUD, a
`changes` stream, and RPC — define a `Process.Schedule` and reference it:

```ts
class SeasonSchedule extends Process.Schedule<SeasonSchedule>()("nwsl/SeasonSchedule") {}
class Poller extends Process.Tag<Poller>()("nwsl/Poller").pipe(Process.schedule(SeasonSchedule)) {}

// provide / serve the schedule resource:
Process.scheduleLayer(SeasonSchedule, { initial: [Process.window("wk1", start, stop)] });
Process.scheduleServe(SeasonSchedule);
```

## See also

- [toolkit-by-example.md](./toolkit-by-example.md) — full patterns (local, remote, groups, UI)
- [../PROCESS-API.md](../PROCESS-API.md) — `Process` / `Polling` spec tables
- [queue-resource.md](./queue-resource.md) — the queue resource
