{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — first-class service for impl + tools

`hyperlink-ts/Lifecycle` is a **Service** (`Lifecycle.Service`) with a shared State badge
and start / pause / resume / stop commands. Toolkit kinds and app HyperServices adopt the
same type — tools never switch on WorkPool vs Daemon.

## The handle

```ts
interface Service {
  readonly state: Subscribable<State>  // Idle | Running | Paused | Draining | Off
  readonly start: Effect<void>
  readonly pause: Effect<void, Unsupported>
  readonly resume: Effect<void, Unsupported>
  readonly stop: Effect<void>
}
```

## Implementation end — `Lifecycle.make`

Own the state machine; pass engine hooks:

```ts
const lifecycle = yield* Lifecycle.make({
  initial: defer ? "Idle" : "Running",
  onStart: forkWorkers,
  onPause: latch.close,
  onResume: latch.open,
  onStop: beginShutdown,
  afterStop: "Off", // or "Idle" when restartable (Daemon)
})

// Wire onto the Spec impl (Role stamps on the contract)
({
  lifecycle: lifecycle.state,   // Hyperlink.ref(Lifecycle.State).pipe(Lifecycle.state)
  start: lifecycle.start,      // .pipe(Lifecycle.start)
  pause: lifecycle.pause,
  resume: lifecycle.resume,
  shutdown: lifecycle.stop,    // or `stop:` — Role "Stop"
})
```

Daemon's toolkit layer already does this. WorkPool currently projects its engine into
`Lifecycle.of(…)` until the queue engine adopts `make` directly.

Deferred bring-up: pipe [`Hyperlink.deferStart`](/docs/lifecycle) onto the HyperService
**layer**, and pass `initial: "Idle"` into `make`.

## Tool end — `Lifecycle.of` / `from`

```ts
import * as Lifecycle from "hyperlink-ts/Lifecycle"

// From a yield* handle
const jobs = yield* Jobs
const lc = Lifecycle.of(jobs)
yield* lc.state.get          // "Idle"
yield* lc.start
yield* lc.pause

// Or map the Tag Effect
const lc2 = yield* Lifecycle.from(Jobs)
```

Generic UIs that only have a Spec (no typed handle) still use `methodMeta(m).lifecycle`
(`"State"` / `"Pause"` / …) — same Roles the Spec stamps use.

## Contract stamps (wire)

```ts
lifecycle: Hyperlink.ref(Lifecycle.State)
  .annotate({ description: "Lifecycle badge." })
  .pipe(Lifecycle.state),
pause: Hyperlink.effect(Schema.Void)
  .annotate({ description: "Hold." })
  .pipe(Lifecycle.pause),
```

Combinators are camelCase; **Role / State strings are PascalCase**.

## See also

- [Policy](/docs/policy) — dial / verify / conflict / yield (different grain)
- [WorkPool](/docs/work-pools) · [Daemons](/docs/daemons)
