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

## The handle

```ts
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
[`Hyperlink.deferStart`](/docs/lifecycle) onto the HyperService **layer**.

## Tool end — `Lifecycle.of` / `from`

```ts
const lc = yield* Lifecycle.from(Jobs)
yield* lc.state.get
yield* lc.start
```

## Spec sugar

```ts
const MySpec = {
  ...Lifecycle.spec({ pausable: true }),
}
```
