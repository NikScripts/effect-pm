/**
 * @module examples/forms/queue/queue-resource-priority-retry
 *
 * QueueResource priority lanes, in-flight dedup, auto re-enqueue (`attempts`), and lifecycle
 * observation via `events` + `Resource.runForEachTag`.
 *
 * Tip surface: `Tag` + `layer` (see Queues guide). Run: `pnpm run example:queue-resource`
 */

import { Cause, Duration, Effect, Schema } from "effect";
import { QueueResource, Resource } from "../../../src";

// ── Contract: payload + typed worker failure ──────────────────────────────────

const EmailJob = Schema.Struct({
  id: Schema.String,
  to: Schema.String,
  /** Demo flag: fail attempt 1 so the queue schedules a retry. */
  failFirstAttempt: Schema.Boolean,
});

/**
 * Wire-ready failure for the tag's `error` slot.
 * Prefer `Schema.TaggedErrorClass` (yieldable + encodable) over `Data.TaggedError` when the
 * failure is part of the public queue contract.
 */
class SendError extends Schema.TaggedErrorClass<SendError>()("SendError", {
  id: Schema.String,
  reason: Schema.String,
}) {}

class EmailQueue extends QueueResource.Tag<EmailQueue>()("examples/EmailQueue", {
  payload: EmailJob,
  error: SendError,
}) {}

/** Poll `status.completed` until `expected` finished attempts (success or failure each count once). */
const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* EmailQueue;
    while (true) {
      const { completed } = yield* queue.status.get;
      if (completed >= expected) return completed;
      yield* Effect.sleep(Duration.millis(10));
    }
  });

// ── Layer: worker + policy (Tag stays free of runtime config) ─────────────────

const EmailQueueLive = QueueResource.layer(EmailQueue, {
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
      );

      if (job.failFirstAttempt && ctx.attempts === 1) {
        return yield* new SendError({
          id: job.id,
          reason: "simulated transient SMTP failure",
        });
      }

      yield* Effect.logInfo(`sent:${job.id}`);
    }),
});

// ── Drive: observe → enqueue → resume → wait ──────────────────────────────────

const program = Effect.gen(function* () {
  const queue = yield* EmailQueue;

  // Fork one subscriber before resume so early Enqueued / Started events aren't missed.
  yield* Effect.forkScoped(
    queue.events.pipe(
      Resource.runForEachTag({
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
  );

  // Lanes while paused: high → normal → low. With concurrency 1, drain order matches.
  yield* queue.add([
    { id: "welcome", to: "reader@example.com", failFirstAttempt: true },
  ]);
  yield* queue.defer([
    { id: "newsletter", to: "reader@example.com", failFirstAttempt: false },
  ]);
  yield* queue.prioritize([
    { id: "password-reset", to: "reader@example.com", failFirstAttempt: false },
  ]);

  const pending = yield* queue.size.get;
  yield* Effect.logInfo(`pending before resume: ${String(pending)}`);

  yield* queue.resume;

  // welcome: fail + succeed (2) + two other jobs once each → 4 finished attempts.
  const completed = yield* waitUntilCompleted(4);
  yield* Effect.logInfo(`completed item attempts: ${String(completed)}`);

  const empty = yield* queue.isEmpty.get;
  yield* Effect.logInfo(`queue empty: ${String(empty)}`);
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(EmailQueueLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("form:queue-resource-priority-retry finished OK")),
  ),
);
