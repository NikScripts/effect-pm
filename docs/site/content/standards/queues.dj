{#queues title="Queues" appliesTo=all}
# Queues

A `QueueResource` drains a stream of items through a handler effect, with
priority, de-duplication, automatic retry, and a pool of workers — all declared
on the tag.

## Define a queue

The handler `effect` runs per item. `key` de-duplicates in-flight items;
`attempts` re-enqueues on failure; `concurrency` sizes the worker pool.

``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Data, Effect } from "effect"

interface EmailJob {
  readonly id: string
  readonly to: string
}

class SendError extends Data.TaggedError("SendError")<{
  readonly id: string
}> {}

class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, SendError>()(
  "app/EmailQueue",
  {
    paused: true,            // enqueue first, then resume — a common bootstrap
    concurrency: 4,
    key: (job) => job.id,    // dedup: same id is skipped while in flight
    attempts: 2,             // 1 initial + 1 retry, then dead-lettered
    effect: (job, ctx) =>
      Effect.log(`send ${job.id} (attempt ${ctx.attempts}, ${ctx.priority})`),
  },
) {}
```

## Enqueue at three priorities

`add` is normal priority; `prioritize` jumps the line; `defer` sinks to the back.

``` ts
const program = Effect.gen(function* () {
  const queue = yield* EmailQueue

  yield* queue.add([{ id: "welcome", to: "reader@example.com" }])
  yield* queue.prioritize([{ id: "password-reset", to: "reader@example.com" }])
  yield* queue.defer([{ id: "newsletter", to: "reader@example.com" }])

  yield* queue.resume                 // workers start draining
  const pending = yield* queue.size
})
```

## Observe the lifecycle

The `events` stream reports enqueue, completion, retry, and dead-letter.
Subscribe once, off-fiber, and dispatch by tag with `Resource.runForEachTag`.

``` ts
import { Resource } from "@nikscripts/effect-pm"
import { Cause } from "effect"

yield* Effect.forkScoped(
  queue.events.pipe(
    Resource.runForEachTag({
      Completed: (e) => Effect.log(`sent ${e.entry.item.id}`),
      RetryExhausted: (e) =>
        Effect.logError(`dead-letter ${e.entry.item.id}: ${Cause.pretty(e.cause)}`),
    }),
  ),
)
```

{.note}
Effect queues can't enumerate their pending items — you target what you know
(`drop`, `deadLetter` by matching an item), and read counts (`size`, `completed`,
per-priority `sizes`) rather than listing.

## Live

The dashboards render this same tag. Here's the queue widget:

``` queue
app/EmailQueue
```
