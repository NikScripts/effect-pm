/**
 * @module examples/forms/queue/queue-resource-priority-retry
 *
 * QueueResource priority, dedup, lifecycle-hook retry. Run: `pnpm run example:queue-resource`
 */

import { Cause, Data, Duration, Effect, Exit } from "effect";
import { QueueResource, type QueueHandle } from "../../../src";

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
    retries: 1,
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
    // Runs in a forked fiber per item — failures don't block the worker loop.
    onExit: ({ entry, exit, retry }) =>
      Exit.match(exit, {
        onFailure: (cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `onExit saw failure for ${entry.item.id}: ${Cause.pretty(cause)}`,
            );
            yield* retry;
          }),
        onSuccess: () =>
          Effect.logInfo(`onExit saw success for ${entry.item.id} after ${String(entry.attempts)} attempt(s)`),
      }),
    onEnqueued: (batch) =>
      Effect.logInfo(`enqueued ${String(batch.entries.length)} ${batch.priority} job(s)`),
    onRetryExhausted: ({ entry, cause }) =>
      Effect.logError(`dead-letter ${entry.item.id}: ${Cause.pretty(cause)}`),
  },
) {}

const program = Effect.gen(function* () {
  const queue = yield* EmailQueue;

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
