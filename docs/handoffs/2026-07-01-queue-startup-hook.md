# Request: a first-class queue **startup hook** (`onStarted`) in `QueueResource`

**From:** wow-sports services-hub (source: `wow-sports/docs/effect-pm/queue-startup-seed-hook-request.md`).
**Status:** open, unbuilt. Small + well-specified — ready to build on a go.

## The gap

0.8.x unified `QueueResource` and **removed the config lifecycle hooks** (`onStart` / `onStarted` /
`onExit` / `onCompleted` / `onFailed` / …), moving **observation** to the consumer-side `queue.events`
stream and **durability** to a store. That split is right for observation — but `onStart` carried a
second, distinct job: **a startup action** — seed/refill the queue exactly once when its workers start,
with the live handle. For that there is **no first-class replacement**: a consumer must hold the handle
and hand-roll a `queue.events` subscriber filtered to `Started`, with its own run-once gating, fiber, and
scope management. Boilerplate, and easy to get subtly wrong.

It's a recurring need: effect-pm's own `demo-queues` example **and** wow's services-hub (6 league import
queues) all used `onStart` purely to **seed on start**.

## Proposal (preferred)

A scoped, run-once startup hook on `QueueResourceConfigBase<T>` (so both `WithItemSchema` and
`WithoutItemSchema` get it):

```ts
/** Runs exactly once after workers start (post-acquisition), in the queue's scope, with the live
 *  handle. The startup counterpart to the `Started` lifecycle event. */
readonly onStarted?: (queue: QueueHandleApi<T, E, R>) => Effect.Effect<void, never, R>;
```

Semantics:
- Fires once on (auto)start; with `autoStart: false`, on explicit `start()`.
- **Forked** — never blocks worker startup.
- Failures logged / surfaced on `events`, **never fatal** to the queue.
- Effectively the old `onStart` minus the unused event arg, renamed to the new `Started` vocabulary.

## Alternative (lighter)

Export a documented **`seedOnStart`** combinator that wraps `queue.events` (filter `Started`) + run-once,
so consumers get one-liner parity without re-implementing the fiber/gating.

## Consumer usage once it lands

```ts
const nwslRosterImportQueueConfig = {
  effect: (job, _ctx) => /* … */,
  concurrency: 10,
  onStarted: (queue) => runNwslRosterImportQueueRefill(queue), // wave-gated; safe if re-fired
} satisfies QueueResourceConfigWithoutItemSchema<NwslRosterImportJob, never, R>;
```

wow's six refills are already idempotent (module-level wave gate), so once-or-more firing is safe.

## Interim (consumer side, safe)

The services-hub migration branch stopgaps by removing the `onStart`/`onExit` blocks to compile against
beta.2; the refill invocation is parked behind `TODO(effect-pm-startup-hook)` in each queue file. The
branch is **not deployed**, so the gap is safe until `onStarted` ships.

## effect-pm assessment

Low-risk, additive config field on `QueueResourceConfigBase`; the engine already emits `Started`, so the
hook is a forked, run-once subscriber to it, scoped to the queue. Ships as a `minor`. Worth confirming the
handle type passed (`QueueHandleApi<T, E, R>`) and that failures route to `events` + a log, not a defect.
