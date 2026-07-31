{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — Effect-native FiberHandle + Latch control panel

`hyperlink-ts/Lifecycle` composes real Effect concurrency primitives:
{@link FiberHandle} / {@link FiberSet}, optional {@link Latch}, and a {@link SubscriptionRef}
badge. Drive them with dual ops (`Lifecycle.start(lc)`). **State, Event, and errors are
`_tag` ADTs** — match with `Match`, [`Hyperlink.runForEachTag`](/docs/observe), or
`Effect.catchTag`. Transition events are **derived** from badge changes (no parallel PubSub).

This is the **HyperService** plane (WorkPool / Daemon). Node cutover uses a separate
`Node.status.phase` (`draining` / …) — see [Identity coordinator](/docs/identity-coordinator).

**Handoff is orthogonal.** A serve-site `handoff` is just `(from, to, ctx)` over two
identical handles. Lifecycle does not gate it; the handoff Effect may observe
`lifecycle` if it wants. Without a handoff fn, shutdown only **stops** the service so
Scope `addFinalizer` runs (`Lifecycle.stop`).

## Implementation — compose + dual

```ts
const latch = yield* Latch.make(true)
const lc = yield* Lifecycle.make({
  run: workerLoop,
  latch,                              // omit ⇒ non-pausable (LifecycleCore)
  release: windDown,
  awaitBeforeTerminal: Deferred.await(offDone), // optional
  afterStop: Lifecycle.off,           // or Lifecycle.idle (Daemon)
  // fibers: { _tag: "Set", set }     // optional; default fresh FiberHandle
})

yield* Lifecycle.start(lc)            // FiberHandle.run
yield* Lifecycle.pause(lc)            // latch.close
yield* Lifecycle.resume(lc)           // latch.open
yield* Lifecycle.stop(lc)             // same path as Scope finalizer
yield* SubscriptionRef.get(lc.state)  // { _tag: "Running" }
yield* Lifecycle.events(lc).pipe(     // derived from state.changes
  Hyperlink.runForEachTag({
    Started: () => Effect.log("up"),
    Stopped: (e) => Effect.log(e.to._tag),
  }),
)
```

| `make` | Type | Pause |
|--------|------|-------|
| `{ latch }` | `LifecyclePausable` | `Lifecycle.pause` / `resume` |
| no latch | `LifecycleCore` | `pause` fails `LifecycleUnsupported` |

Deferred bring-up: pipe [`Hyperlink.deferStart`](/docs/lifecycle#deferred-start) onto the
HyperService **layer** (not a config flag). Ambient `DeferStart` keeps Idle until `start`.

### State tags

| `_tag` | Meaning |
|--------|---------|
| `Idle` | Acquired; workers not forked yet (`Hyperlink.deferStart`) |
| `Running` | Accepting / processing |
| `Paused` | Latch closed; enqueue still works |
| `Draining` | `stop` in progress; later enqueues dropped |
| `Off` | Terminal (WorkPool); Daemon uses `afterStop: Idle` |

## Tool end — `Lifecycle.of` / `from`

Wire HyperServices still expose Participating fields (`lifecycle`, `start`, …). Tools project:

```ts
const lc = yield* Lifecycle.from(Jobs)
yield* lc.state.get
yield* lc.start
yield* lc.stop
```

WorkPool / Priority expose the badge as `jobs.lifecycle` (`Subscribable<Lifecycle.State>`).
Prefer `lifecycle._tag` for UI badges and readiness — there is **no** `status.phase`.

## Spec sugar

```ts
const MySpec = {
  ...Lifecycle.spec({ pausable: true }),
}
```

Roles stamp as PascalCase via `.pipe(Lifecycle.asStart)` / `asPause` / `asResume` /
`asStop` (dual ops stay `Lifecycle.start(lc)` etc.). Spec includes `lifecycleEvents`
(derived stream on the wire).

## Observe pack

```ts
import * as LifecycleView from "hyperlink-ts/ui/LifecycleView"

const box = Observe.use(Jobs, LifecycleView.pausable) // badge + start/stop/pause/resume
// Daemon (no Latch): Observe.use(Sweeper, LifecycleView.pack)
```

Lifecycle core does not import Observe — the pack lives under `ui/LifecycleView` (Agent G owns chrome).

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
