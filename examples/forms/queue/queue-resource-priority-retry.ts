/**
 * @module examples/forms/queue/queue-resource-priority-retry
 *
 * QueueResource priority, dedup, auto re-enqueue (`attempts`), and observing lifecycle via the
 * `events` stream with `Resource.runForEachTag`. Run: `pnpm run example:queue-resource`
 */

import { Cause, Data, Duration, Effect } from "effect";
import { QueueResource, Resource, type QueueHandle } from "../../../src";

interface EmailJob {
  readonly id: string;
  readonly to: string;
  readonly failFirstAttempt: boolean;
}

class SendError extends Data.TaggedError("SendError")<{
  readonly id: string;
  readonly reason: string;
}> {}

const waitUntilCompleted = (
  queue: QueueHandle<EmailJob, SendError, never, never>,
  expected: number,
) =>
  Effect.gen(function* () {
    while (true) {
      const completed = yield* queue.completed;
      if (completed >= expected) return completed;
      yield* Effect.sleep(Duration.millis(10));
    }
  });

class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, SendError>()(
  "examples/EmailQueue",
  {
    paused: true, // enqueue while paused, then resume — common bootstrap pattern
    concurrency: 1,
    capacity: 100,
    key: (job) => job.id, // dedup: same id is skipped while in flight
    attempts: 2, // auto re-enqueue: 2 attempts (1 initial + 1 retry), then exhausted
    effect: (job, ctx) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `send attempt ${String(ctx.attempts)} for ${job.id} (${ctx.priority})`,
        );

        if (job.failFirstAttempt && ctx.attempts === 1) {
          return yield* new SendError({
            id: job.id,
            reason: "simulated transient SMTP failure",
          });
        }

        yield* Effect.logInfo(`sent:${job.id}`);
      }),
  },
) {}

const program = Effect.gen(function* () {
  const queue = yield* EmailQueue;

  // observe lifecycle off the events stream (replaces the old onExit/onEnqueued/onRetryExhausted
  // hooks) — one off-fiber subscriber, dispatched by tag.
  yield* Effect.forkScoped(
    queue.events.pipe(
      Resource.runForEachTag({
        Enqueued: (e) =>
          Effect.logInfo(`enqueued ${String(e.entries.length)} ${e.priority} job(s)`),
        Completed: (e) =>
          Effect.logInfo(`sent ${e.entry.item.id} after ${String(e.entry.attempts)} attempt(s)`),
        RetryScheduled: (e) =>
          Effect.logWarning(`retry ${e.entry.item.id}: ${Cause.pretty(e.cause)}`),
        RetryExhausted: (e) =>
          Effect.logError(`dead-letter ${e.entry.item.id}: ${Cause.pretty(e.cause)}`),
      }),
    ),
  );

  yield* queue.add([
    { id: "welcome", to: "reader@example.com", failFirstAttempt: true },
  ]);
  yield* queue.defer([
    { id: "newsletter", to: "reader@example.com", failFirstAttempt: false },
  ]);
  yield* queue.prioritize([
    { id: "password-reset", to: "reader@example.com", failFirstAttempt: false },
  ]);

  const pending = yield* queue.size;
  yield* Effect.logInfo(`pending before resume: ${String(pending)}`);

  yield* queue.resume;

  // welcome runs twice (handler retry) → 4 completed attempts total for 3 jobs.
  const completed = yield* waitUntilCompleted(queue, 4);
  yield* Effect.logInfo(`completed item attempts: ${String(completed)}`);

  const empty = yield* queue.isEmpty;
  yield* Effect.logInfo(`queue empty: ${String(empty)}`);
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(EmailQueue.layer),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("form:queue-resource-priority-retry finished OK")),
  ),
);
