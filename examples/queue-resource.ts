/**
 * @module examples/queue-resource
 *
 * ## QueueResource — priority, deduplication, and handler-driven retry
 *
 * This standalone example focuses only on the queue API. Use it when you want
 * the smallest runnable reference for:
 *
 * - declaring a queue with `QueueResource.Service`;
 * - enqueuing normal, high-priority, and background work;
 * - retrying from the forked `handler` with `ctx.retry`;
 * - reading effectful properties such as `queue.size` and `queue.completed`.
 *
 * Run:
 *
 * ```bash
 * pnpm run example:queue-resource
 * ```
 */

import { Cause, Data, Duration, Effect, Exit } from "effect";
import { QueueResource, type QueueHandle } from "../src";
import { provideLayer } from "../src/provideLayer.js";

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
  queue: QueueHandle<EmailJob, string, SendError>,
  expected: number,
) =>
  Effect.gen(function* () {
    while (true) {
      const completed = yield* queue.completed;
      if (completed >= expected) return completed;
      yield* Effect.sleep(Duration.millis(10));
    }
  });

class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, string, SendError>()(
  "examples/EmailQueue",
  {
    paused: true,
    concurrency: 1,
    capacity: 100,
    key: (job) => job.id,
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

        return `sent:${job.id}`;
      }),
    handler: (job, exit, ctx) =>
      Exit.match(exit, {
        onFailure: (cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `handler saw failure for ${job.id}: ${Cause.pretty(cause)}`,
            );
            yield* ctx.retry;
          }),
        onSuccess: (result) =>
          Effect.logInfo(
            `handler saw success for ${job.id}: ${result} after ${String(ctx.attempts)} attempt(s)`,
          ),
      }),
    onEnqueue: (jobs, priority) =>
      Effect.logInfo(`enqueued ${String(jobs.length)} ${priority} job(s)`),
    onRetryExhausted: (job, cause) =>
      Effect.logError(`dead-letter ${job.id}: ${Cause.pretty(cause)}`),
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

  // Three jobs run, and `welcome` runs twice because the handler retries it once.
  const completed = yield* waitUntilCompleted(queue, 4);
  yield* Effect.logInfo(`completed item attempts: ${String(completed)}`);

  const empty = yield* queue.isEmpty;
  yield* Effect.logInfo(`queue empty: ${String(empty)}`);
});

const runnable = program.pipe(provideLayer(EmailQueue.layer), Effect.scoped);

void Effect.runPromise(
  runnable.pipe(
    Effect.tap(() => Effect.logInfo("example:queue-resource finished OK")),
  ),
);
