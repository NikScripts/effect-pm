# Daemon

A **managed process** is a named unit of background work: an `effect` that runs to completion on
each **repeat**, driven by a long-lived supervisor that coordinates **polling** (how long between
repeats while armed) and **schedule** (whether repeats are allowed now). It's a location-transparent
`Hyperlink` — lifecycle + observability + schedule control behind one `Tag`.

`Daemon` is one module: the toolkit contract (`Daemon.Tag` / `Daemon.Schedule` / {@link DaemonTagOptions})
plus the engine (`Daemon.make` / `layer` / `serve`) over **`Polling`** and the internal schedule
primitive. A `Daemon.Tag`-only import pulls **zero** engine code; the engine loads when you call
`make` / `layer` / `serve`. See [../PROCESS-API.md](../PROCESS-API.md) and
[./store.md](./store.md) for persistence.

---

## Choose your entry point

| You want | Use | Execution history |
|----------|-----|-------------------|
| Embed the supervisor in your own layer graph | **`Daemon.make`** | **Off** — no auto-append; call `store.record` or switch to `layer` |
| A toolkit resource (local or RPC) | **`Daemon.layer`** | **On** — terminal runs append to `Daemon.store(tag)` |
| HTTP/RPC host without local instance | **`Daemon.serveRemote`** | **On** (same as `layer`) |
| HTTP/RPC host with local instance | **`Daemon.serve`** | **On** (same as `layer`) |

`Daemon.make` is for forms, tests, and custom composition. Production apps that need run history
should use **`Daemon.layer`** (or register **`Daemon.store(tag)`** and append manually).

---

## Define a tag

```ts
import { Effect, Schema } from "effect";
import * as Daemon from "hyperlink-ts/Daemon";

class LiveScores extends Daemon.Tag<LiveScores>()("nwsl/LiveScores") {}

const layer = Daemon.layer(LiveScores, {
  effect: pollLiveScores,
  // polling: Polling.spaced(Duration.seconds(30)),
});
```

Provide `Logs.layer` + `Logs.persistLayer(node)` on the node stack for durable logs; read with
`Hyperlink.logs(LiveScores)` — see [`docs/LOGS.md`](../../LOGS.md).

- **`Daemon.layer(Tag, config)`** — local driver (auto-starts).
- **`Daemon.serve(Tag, config)`** / **`serveRemote`** — host over RPC.
- **`Hyperlink.client(Tag)`** — remote handle.

### Tag wire schemas (`success` / `error`)

Declare on the tag via the **config object** (names match Effect `Hyperlink.Method` slots:
`success` / `error`). Daemon has **no** tag-level `payload` (the tick body is in layer config).

```ts
const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

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

**Removed:** `Daemon.result(Schema)` pipe and positional schema overloads — use `{ success?, error?, … }` on the tag.

**Store vs RPC:** `success` and `error` on the tag drive the **execution store** wire (`Completed.success`,
`Failed.error`) and live `result` when `success` is set. They do **not** change Daemon RPC error
responses today — lifecycle RPC methods remain void with no typed failure channel. Failures from poll
ticks are persisted via `Daemon.store`; remote clients observe them through store reads or logs, not
through an RPC `error` slot. See
[agent report § RPC error wire blocker](../../handoffs/archive/2026-07/reports/2026-07-07-agent-report-process.md#rpc-error-wire-blocker).

### Schedule (pipeable)

```ts
class Matches extends Daemon.Tag<Matches>()("nwsl/Matches").pipe(
  Daemon.schedule([Daemon.window(gameStart, gameEnd)]),
) {}

// empty inline schedule — disarmed until `schedule.add` / `set`
class Ingest extends Daemon.Tag<Ingest>()("nwsl/Ingest").pipe(Daemon.schedule([])) {}
```

---

## Handle surface (`yield* Tag`)

- **Lifecycle:** `start`, `stop`, `run` (typed success/error on RPC when stamped).
- **Observe:** `status` (`status.get` / `status.changes`). Logs via `Hyperlink.logs(Tag)` /
  `NodeStatus.logs` + `LogEntry.hasKey` — not on the process handle.
- **Schedule** (inline schedule only): `schedule.entries`, `schedule.set` / `add` / `clear`.
- **Result** (when `success` on tag): `result.get` / `result.changes` — `Option` until first success.

---

## Execution store (`Daemon.store`)

Register the built-in execution contract on an app **`Store.Service`**. Rows are an append-only
event union — same shape the toolkit layer persists on terminal runs.

### Register

```ts
import * as Store from "hyperlink-ts/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Daemon.store(Prices),
) {}

const store = yield* Prices.store;
yield* store.record({
  _tag: "Completed",
  processId: Prices.key,
  scheduleKey: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1,
  isStartupRun: true,
  success: { symbol: "AAPL", usd: 1.2 },
});
const rows = yield* store.events({ limit: 10 });
```

### Wire shape (locked)

| Field | Rule |
|-------|------|
| **`_tag`** | `Started` \| `Completed` \| `Failed` \| `Interrupted` |
| **`success`** | On `Completed` **only if** the tag stamps `success`; field name is `success` (not `result`) |
| **`error`** | Always on `Failed`; typed when the tag stamps `error`, otherwise **`string`** (`String` of the fail value) |
| **`isStartupRun`** | `true` when no prior execution row exists for this process |

**Encoding:** The toolkit layer writes `Failed.error` from the tick failure cause — typed when
`errorOf(tag)` is set, else stringified. This matches store-core §5 and is independent of RPC: there
is no typed Daemon RPC failure payload yet.

Rich types (`DateTime`, tagged errors, etc.) round-trip when the journal uses schema codecs — stamp
the same schemas on the tag.

Example: [process-layer-typed-error-store.ts](../../../examples/forms/process-store/process-layer-typed-error-store.ts).

### Auto-append on toolkit layers

On **`Daemon.layer`** / **`serve`** / **`serveRemote`**, finished runs append automatically. The
layer merges a **default in-memory store** (`Store.layerDefaultMemory`). Override with your app store
when you need durability or a registered handle (app store merged **second** — later layer wins on
`Store.Storage`):

```ts
import { Layer } from "effect";

const live = Daemon.layer(Prices, { effect: poll }).pipe(
  Layer.provideMerge(AppStore.layerMemory),
);

// durable
const durable = Daemon.layer(Prices, { effect: poll }).pipe(
  Layer.provideMerge(AppStore.layer({ filename: ".hyperlink-ts/process.sqlite" })),
);
```

Query after runs: `yield* Prices.store` → `events()`, `hasPriorExecutions()`.

**`Daemon.make`** does not auto-append. Provide storage yourself or use `Daemon.layer`.

---

## `Daemon.make` (embeddable supervisor)

```ts
const proc = Daemon.make("examples/polling-demo", {
  effect: tick,
  polling: Polling.spaced(Duration.millis(50)),
});

// fork when ready — polling/schedule layers are merged into proc.effect
yield* Effect.forkScoped(proc.effect.pipe(Effect.provide(myEnv)));
```

No `Store.Storage` requirement unless you append to a store yourself. Same supervisor semantics as
the toolkit path (armed/disarmed, polling cadence, `run`).

---

## Examples in this repo

| Path | Focus |
|------|--------|
| [examples/forms/schedule/](../../examples/forms/schedule/) | Windows, `at`, controls, `scheduleDefine` |
| [examples/forms/polling/](../../examples/forms/polling/) | Spaced / accelerating cadence, `TestClock` |
| [examples/forms/process-store/process-layer-store-auto-write.ts](../../../examples/forms/process-store/process-layer-store-auto-write.ts) | `Daemon.layer` + `Daemon.store` + override |
| [examples/forms/process-store/process-layer-typed-error-store.ts](../../../examples/forms/process-store/process-layer-typed-error-store.ts) | Typed `Failed.error` on store rows |

---

## See also

- [../../handoffs/archive/2026-07/reports/2026-07-07-agent-report-process.md](../../handoffs/archive/2026-07/reports/2026-07-07-agent-report-process.md) — RPC `error` wire blocker (owner decision)

- [../../handoffs/store-cutover-daemon.md](../../handoffs/store-cutover-daemon.md) — store cutover status (authoritative)
- [toolkit-by-example.md](./toolkit-by-example.md) — location-transparent resources
- [store.md](./store.md) — `Store.Service`, contracts, SQLite backing
- [history-and-persistence.md](./history-and-persistence.md) — log/metrics history (`HistoryStore`)
- [../PROCESS-API.md](../PROCESS-API.md) — full spec-style reference
