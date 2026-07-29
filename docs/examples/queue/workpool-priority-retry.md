{#workpool-priority-retry title="Queue — Priority, Dedup, Retry" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/workpool-priority-retry>.
<!-- docs-site-link:end -->
# Queue — Priority, Dedup, Retry

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/queue/workpool-priority-retry.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/queue/workpool-priority-retry.ts)  
**Run:** `pnpm run example:workpool-retry`  
**Hub:** [Examples → Queue](/docs/examples#queue)  
**Deep guide:** [Queues](/docs/work-pools)

## What this form shows

One `WorkPool` handle exercising four operators together:

1. **Lanes** — `add` (normal), `prioritize` (high), `defer` (low); each accepts a batch array
   (one RPC round-trip when remote).
2. **Dedup** — `key: (job) => job.id` skips a second enqueue of the same id **while that key
   is in flight** (not a permanent cache — the key frees when the attempt finishes, including
   before an auto re-enqueue).
3. **Retry budget** — `attempts: 2` means one automatic re-enqueue after failure, then
   `RetryExhausted`. No `onFailure` here → the default disposition (retry until budget, then
   dead-letter). Per-error routing belongs in `onFailure` on the [Queues](/docs/work-pools) guide.
4. **Lifecycle** — one `events` subscriber with `Hyperlink.runForEachTag` (pick the tags you
   care about; ignore the rest). Prefer this over old onExit-style hooks.

Surface is the tip **`Tag` + `layer`** split (contract vs runtime). Bootstrap: start
**`paused: true`**, wire the subscriber and enqueue, then **`resume`** so nothing drains
mid-setup.

`concurrency: 1` keeps drain order readable for the demo (high → normal → low). Raise it for
I/O-bound work; `rateLimit` is the separate start-rate ceiling (not shown here).

The worker failure is a **`Schema.TaggedErrorClass`** on the tag's `error` slot — yieldable
and wire-encodable. A bare `Schema.String` also works for local-only demos; use the schema
error class when the failure is part of the public contract.

## Expected run

Three jobs. Drain order with `concurrency: 1`: **password-reset** (high), **welcome**
(normal), **newsletter** (low). `welcome` fails on attempt 1 and succeeds on attempt 2; the
others succeed once.

`status.completed` counts **finished attempts** (success *or* failure each increment once) —
so expect **≈ 4**, then the queue is empty. That is not “unique jobs” and not “successful
sends only.” On the tip `Tag` handle there is no top-level `queue.completed`; read it from
`status` (same snapshot that carries `sizes` / `inFlight` / `phase`).

## The program

{.twoslash}
``` ts
import { Cause, Duration, Effect, Schema } from "effect"
import { WorkPool, Hyperlink } from "hyperlink-ts"

// ── Contract: payload + typed worker failure ──────────────────────────────────

const EmailJob = Schema.Struct({
  id: Schema.String,
  to: Schema.String,
  /** Demo flag: fail attempt 1 so the queue schedules a retry. */
  failFirstAttempt: Schema.Boolean,
})

/**
 * Wire-ready failure for the tag's `error` slot.
 * Prefer `Schema.TaggedErrorClass` (yieldable + encodable) over `Data.TaggedError` when the
 * failure is part of the public queue contract.
 */
class SendError extends Schema.TaggedErrorClass<SendError>()("SendError", {
  id: Schema.String,
  reason: Schema.String,
}) {}

class EmailQueue extends WorkPool.Tag<EmailQueue>()("examples/EmailQueue", {
  payload: EmailJob,
  error: SendError,
}) {}

/** Poll `status.completed` until `expected` finished attempts (success or failure each count once). */
const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* EmailQueue
    while (true) {
      const { completed } = yield* queue.status.get
      if (completed >= expected) return completed
      yield* Effect.sleep(Duration.millis(10))
    }
  })

// ── Layer: worker + policy (Tag stays free of runtime config) ─────────────────

const EmailQueueLive = WorkPool.layer(EmailQueue, {
  paused: true, // enqueue / subscribe first; drain only after `resume`
  concurrency: 1, // sequential — log order stays readable for the demo
  capacity: 100,
  key: (job) => job.id, // same id while in flight → skipped (not a permanent cache)
  attempts: 2, // initial try + one automatic re-enqueue; then RetryExhausted
  // No `onFailure` → default disposition: retry until `attempts`, then dead-letter.
  effect: (job, ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `send attempt ${String(ctx.attempts)} for ${job.id} (${ctx.priority})`,
      )

      if (job.failFirstAttempt && ctx.attempts === 1) {
        return yield* new SendError({
          id: job.id,
          reason: "simulated transient SMTP failure",
        })
      }

      yield* Effect.logInfo(`sent:${job.id}`)
    }),
})

// ── Drive: observe → enqueue → resume → wait ──────────────────────────────────

const program = Effect.gen(function* () {
  const queue = yield* EmailQueue

  // Fork one subscriber before resume so early Enqueued / Started events aren't missed.
  yield* Effect.forkScoped(
    queue.events.pipe(
      Hyperlink.runForEachTag({
        Enqueued: (e) =>
          Effect.logInfo(`enqueued ${String(e.entries.length)} ${e.priority} job(s)`),
        Completed: (e) =>
          Effect.logInfo(
            `sent ${e.entry.item.id} after ${String(e.entry.attempts)} attempt(s)`,
          ),
        RetryScheduled: (e) =>
          Effect.logWarning(`retry ${e.entry.item.id}: ${Cause.pretty(e.cause)}`),
        RetryExhausted: (e) =>
          Effect.logError(`dead-letter ${e.entry.item.id}: ${Cause.pretty(e.cause)}`),
      }),
    ),
  )

  // Lanes while paused: high → normal → low. With concurrency 1, drain order matches.
  yield* queue.add([
    { id: "welcome", to: "reader@example.com", failFirstAttempt: true },
  ])
  yield* queue.defer([
    { id: "newsletter", to: "reader@example.com", failFirstAttempt: false },
  ])
  yield* queue.prioritize([
    { id: "password-reset", to: "reader@example.com", failFirstAttempt: false },
  ])

  const pending = yield* queue.size.get
  yield* Effect.logInfo(`pending before resume: ${String(pending)}`)

  yield* queue.resume

  // welcome: fail + succeed (2) + two other jobs once each → 4 finished attempts.
  const completed = yield* waitUntilCompleted(4)
  yield* Effect.logInfo(`completed item attempts: ${String(completed)}`)

  const empty = yield* queue.isEmpty.get
  yield* Effect.logInfo(`queue empty: ${String(empty)}`)
})

void Effect.runPromise(
  program.pipe(
    Effect.provide(EmailQueueLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("form:queue-hyperlink-priority-retry finished OK")),
  ),
)
```
