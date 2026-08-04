/**
 * @module examples/work-pool/rate-limit
 *
 * WorkPool drain rate limiting: concurrency can be higher than one while `rateLimit`
 * caps how quickly workers may start items.
 *
 * Tip surface: `rateLimit` config. Run: `pnpm run example:work-pool-rate-limit`
 *
 * Docs: `docs/examples/work-pool/rate-limit.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Clock, Duration, Effect, Ref, Schema } from "effect";
import { Hyperlink, WorkPool } from "../../src";

const LimitedJob = Schema.Struct({
  id: Schema.String,
});

class LimitedQueue extends WorkPool.Service<LimitedQueue>()(
  "examples/LimitedQueue",
  { payload: LimitedJob },
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* LimitedQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const LimitedLive = WorkPool.layer(LimitedQueue, {
  concurrency: 3,
  rateLimit: { limit: 1, window: Duration.millis(80) },
  effect: (job) => Effect.logInfo(`started ${job.id}`),
});

const program = Effect.gen(function* () {
  const queue = yield* LimitedQueue;
  const exceeded = yield* Ref.make(0);

  yield* Effect.forkScoped(
    queue.events.pipe(
      Hyperlink.runForEachTag({
        RateLimitExceeded: (event) =>
          Ref.update(exceeded, (n) => n + 1).pipe(
            Effect.tap(() =>
              Effect.logInfo(`rate limit delayed ${event.entry.item.id}`),
            ),
          ),
      }),
    ),
  );
  yield* Effect.sleep(Duration.millis(10));

  const startedAt = yield* Clock.currentTimeMillis;
  yield* queue.add([{ id: "one" }, { id: "two" }, { id: "three" }]);
  yield* waitUntilCompleted(3);
  const elapsed = (yield* Clock.currentTimeMillis) - startedAt;

  yield* Effect.logInfo(`elapsed drain time: ${String(elapsed)}ms`);
  const exceededCount = yield* Ref.get(exceeded);
  yield* Effect.logInfo(`RateLimitExceeded events: ${String(exceededCount)}`);
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(LimitedLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:work-pool-rate-limit finished OK")),
  ),
);
