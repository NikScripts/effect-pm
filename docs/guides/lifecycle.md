{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — Effect-shaped service for impl + tools

`hyperlink-ts/Lifecycle` is a **control panel** over Effect structured concurrency:
{@link FiberHandle} / {@link FiberSet}, optional {@link Latch}, and a {@link SubscriptionRef}
badge. Toolkit kinds and app HyperServices adopt the same {@link Lifecycle.Service} — tools
never switch on WorkPool vs Daemon.

## The handle

```ts
interface Service {
  readonly state: Subscribable<State>  // Idle | Running | Paused | Draining | Off
  readonly changes: Stream<State>
  readonly events: Stream<Event>       // _tag: Started | Paused | …
  readonly start: Effect<void, Illegal>
  readonly pause: Effect<void, Unsupported | Illegal>
  readonly resume: Effect<void, Unsupported | Illegal>
  readonly stop: Effect<void>
}
```

Errors are `Data.TaggedError` — match with `_tag` / `Effect.catchTag`:

```ts
yield* lc.pause.pipe(
  Effect.catchTag("LifecycleUnsupported", (e) => Effect.log(e.role)),
  Effect.catchTag("LifecycleIllegal", (e) => Effect.log(`${e.op} from ${e.from}`)),
)
```

## Implementation — `Lifecycle.make`

Compose primitives; do not pass callback hooks:

```ts
const latch = yield* Latch.make(true)
const lifecycle = yield* Lifecycle.make({
  run: workerLoop,           // FiberHandle (default) or fiber: "set"
  latch,                     // omit ⇒ pause/resume fail Unsupported
  release: windDown,         // optional drain before fiber clear
  restartable: false,        // false → Off; true → Idle (Daemon)
})

// Spec impl
({
  ...Lifecycle.impl(lifecycle),
  // or: lifecycle: lifecycle.state, start, pause, resume, stop
})
```

Daemon's toolkit layer already does this (`restartable: true`, no latch). WorkPool still
projects its engine into `Lifecycle.of(…)` until the queue engine adopts `make` directly.

Deferred bring-up: pipe [`Hyperlink.deferStart`](/docs/lifecycle) onto the HyperService
**layer** — `make` reads `DeferStart` and stays `Idle` until `start`.

## Tool end — `Lifecycle.of` / `from`

```ts
import * as Lifecycle from "hyperlink-ts/Lifecycle"

const lc = yield* Lifecycle.from(Jobs)
yield* lc.state.get
yield* lc.start
```

Generic UIs that only have a Spec still use `methodMeta(m).lifecycle`
(`"State"` / `"Pause"` / …).

## Spec sugar

```ts
const MySpec = {
  ...Lifecycle.spec({ pausable: true }),
  // domain methods…
}
```
