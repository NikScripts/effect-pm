{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — Effect-native FiberHandle + Latch control panel

`hyperlink-ts/Lifecycle` composes real Effect concurrency primitives:
{@link FiberHandle} / {@link FiberSet}, optional {@link Latch}, and a {@link SubscriptionRef}
badge. Drive them with dual ops (`Lifecycle.start(lc)`). The **same duals** accept a wire
Participating HyperService (`Lifecycle.start(jobs)`). **State, Event, and errors are
`_tag` ADTs**. Transition events are **derived** from badge changes (no parallel PubSub).

Heavy engine lives in `internal/lifecycle` — the public module is the namespace + Spec sugar.

This is the **HyperService** plane (toolkit kinds **WorkPool / Daemon / Gate**
participate; apps opt in via Spec). Node cutover uses a separate
`Node.status.phase` (`draining` / …) — see
[Identity coordinator](/docs/identity-coordinator).

## Handoff is orthogonal

A serve-site `handoff` is just `(from, to, ctx)` over two identical handles. Lifecycle does
not gate it; the handoff Effect may observe `lifecycle` if it wants. **Without a handoff
fn**, shutdown only **stops** the service so Scope `addFinalizer` runs (`Lifecycle.stop`).

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
HyperService **layer**. Ambient `DeferStart` keeps Idle until `start`.

### State tags

| `_tag` | Meaning |
|--------|---------|
| `Idle` | Acquired; workers not forked yet (`Hyperlink.deferStart`) |
| `Running` | Accepting / processing |
| `Paused` | Latch closed; enqueue still works |
| `Draining` | `stop` in progress; later enqueues dropped |
| `Off` | Terminal (WorkPool); Daemon uses `afterStop: Idle` |

## Tools — duals on Participating

No projected `Service` bag. Duals accept a Lifecycle handle, a Participating service, or a Tag:

```ts
const jobs = yield* Jobs
yield* Lifecycle.start(jobs)
yield* Lifecycle.pause(jobs)
yield* jobs.lifecycle.get                 // Subscribable<Lifecycle.State>

yield* Lifecycle.start(Jobs)              // Tag Effect overload
yield* Lifecycle.stop(Jobs)
```

WorkPool / Priority expose the badge as `jobs.lifecycle`. Prefer `lifecycle._tag` for UI
badges and readiness — there is **no** `status.phase`.

The same duals work when the Tag is provided by [`Hyperlink.client`](/docs/hyperlink)
(local layer vs client layer — only the Layer differs). Over RPC, observe badge transitions
via `lifecycle.changes` (the client `.get` cache is fed by that stream).

## Spec — Subscribable badge

Wire the badge as a {@link Hyperlink.ref} of {@link Lifecycle.State} (Role `"State"`). Prefer
the stamped helpers:

```ts
class Runner extends Hyperlink.Tag<Runner>()("app/Runner", {
  lifecycle: Lifecycle.stateRef,              // Hyperlink.ref(State).pipe(asState)
  lifecycleEvents: Lifecycle.eventStream,
  start: Hyperlink.effect(Schema.Void).pipe(Lifecycle.asStart),
  stop: Hyperlink.effect(Schema.Void).pipe(Lifecycle.asStop),
  // domain…
}) {}

// or spread:
const MySpec = {
  ...Lifecycle.spec({ pausable: true }),
}
```

Impl side: `...Lifecycle.impl(lc)` (wire verbs use `never` error; duals re-check Illegal).
Provide with `Hyperlink.layer` / toolkit `.layer` — never a `*Live` alias.

## Observe pack

```ts
import * as LifecycleView from "hyperlink-ts/ui/LifecycleView"

const box = Observe.use(Jobs, LifecycleView.pausable)
```

Lifecycle core does not import Observe — the pack lives under `ui/LifecycleView` (Agent G owns chrome).

## Deferred start

```ts
WorkPool.layer(Jobs, { effect }).pipe(Hyperlink.deferStart)
// Idle until:
yield* Lifecycle.start(jobs)
```

## WorkPool control

| Verb | Role | Notes |
|------|------|--------|
| `start` | Start | Fork workers (idempotent) |
| `pause` / `resume` | Pause / Resume | Latch |
| `stop` | Stop | Graceful drain → `Off`; awaits terminal |

Queue domain events still use `ShutdownRequested` / `ShutdownComplete` (item/queue facts).
Wind-down mode remains `shutdownMode: "drain" | "finishActive"`.

Runnable form: [Lifecycle — make + tools](/docs/lifecycle-make-and-tools).
