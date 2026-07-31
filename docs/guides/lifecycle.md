{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — Effect-shaped service for impl + tools

`hyperlink-ts/Lifecycle` is a **control panel** over Effect structured concurrency:
{@link FiberHandle} / {@link FiberSet}, optional {@link Latch}, and a {@link SubscriptionRef}
badge. **State, Event, and errors are all `_tag` ADTs** — match with `Match`,
[`Hyperlink.runForEachTag`](/docs/observe), or `Effect.catchTag`.

This is the **HyperService** plane (WorkPool / Daemon). Node cutover uses a separate
`Node.status.phase` (`draining` / …) — see [Identity coordinator](/docs/identity-coordinator).

## The handle

```ts
// make({ latch }) → ServicePausable (pause/resume on the type)
// make()         → ServiceCore (no pause/resume members)
// of / from      → Service (tools end; pause/resume always present, may fail Unsupported)
interface Service {
  readonly state: Subscribable<State>  // { _tag: "Idle" | "Running" | … }
  readonly changes: Stream<State>
  readonly events: Stream<Event>       // { _tag: "Started" | "Paused" | … }
  readonly start: Effect<void, Illegal>
  readonly pause: Effect<void, Unsupported | Illegal>
  readonly resume: Effect<void, Unsupported | Illegal>
  readonly stop: Effect<void>
}
```

Participating HyperServices expose the badge as `lifecycle` and the transition stream as
`lifecycleEvents` (named distinctly from domain `events` on WorkPool / Daemon).

```ts
yield* lc.state.get                         // { _tag: "Running" }
yield* lc.events.pipe(Hyperlink.runForEachTag({
  Started: () => Effect.log("up"),
  Stopped: (e) => Effect.log(e.to._tag),   // "Off" | "Idle"
}))
yield* lc.pause.pipe(
  Effect.catchTag("LifecycleUnsupported", (e) => Effect.log(e.role)),
  Effect.catchTag("LifecycleIllegal", (e) => Effect.log(e.from._tag)),
)
```

### State tags

| `_tag` | Meaning |
|--------|---------|
| `Idle` | Acquired; workers not forked yet (`Hyperlink.deferStart`) |
| `Running` | Accepting / processing |
| `Paused` | Latch closed; enqueue still works |
| `Draining` | `stop` in progress; later enqueues dropped |
| `Off` | Terminal (WorkPool); Daemon with `restartable` returns to `Idle` |

## Implementation — `Lifecycle.make`

```ts
const latch = yield* Latch.make(true)
const lifecycle = yield* Lifecycle.make({
  run: workerLoop,
  latch,
  release: windDown,
  awaitBeforeTerminal: Deferred.await(offDone), // optional
  restartable: false,
})
```

Daemon and WorkPool toolkit layers both use this. Deferred bring-up: pipe
[`Hyperlink.deferStart`](/docs/lifecycle#deferred-start) onto the HyperService **layer**
(not a config flag).

## Tool end — `Lifecycle.of` / `from`

```ts
const lc = yield* Lifecycle.from(Jobs)
yield* lc.state.get
yield* lc.start
yield* lc.stop
```

WorkPool / Priority expose the same badge as `jobs.lifecycle` (`Subscribable<Lifecycle.State>`).
Prefer `lifecycle._tag` for UI badges and readiness — there is **no** `status.phase`.

## Spec sugar

```ts
const MySpec = {
  ...Lifecycle.spec({ pausable: true }),
}
```

Roles stamp as PascalCase (`"State"` / `"Start"` / `"Pause"` / `"Resume"` / `"Stop"`) for
generic tools via `methodMeta`. Spec includes `lifecycleEvents` alongside `lifecycle`.

## Observe pack

```ts
import * as LifecycleView from "hyperlink-ts/ui/LifecycleView"

const box = Observe.use(Jobs, LifecycleView.pausable) // badge + start/stop/pause/resume
// Daemon (no Latch): Observe.use(Sweeper, LifecycleView.pack)
```

Lifecycle core does not import Observe — the pack lives under `ui/LifecycleView`.

## Deferred start

```ts
WorkPool.layer(Jobs, { effect }).pipe(Hyperlink.deferStart)
// Idle until:
yield* jobs.start
```

Ambient `Hyperlink.DeferStart` defaults to `false` (auto-start on acquire). There is no
`autoStart` config field.

## WorkPool control

| Verb | Role | Notes |
|------|------|--------|
| `start` | Start | Fork workers (idempotent) |
| `pause` / `resume` | Pause / Resume | Latch |
| `stop` | Stop | Graceful drain → `Off`; awaits terminal |

Queue domain events still use `ShutdownRequested` / `ShutdownComplete` (item/queue facts).
Wind-down mode remains `shutdownMode: "drain" | "finishActive"`.

Runnable form: [Lifecycle — make + tools](/docs/lifecycle-make-and-tools).
