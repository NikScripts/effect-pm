import { Duration, Effect, Fiber, Schema, Stream } from "effect";
import { expect, it } from "vitest";
import { QueueResource } from "../src";

const Item = Schema.Struct({ n: Schema.Number });

class LiveQueue extends QueueResource.Tag<LiveQueue>()("qr-handle-ref/live", { payload: Item }) {}

/** Mirrors `src/web/data.ts` — widgets subscribe via `q.status.changes`. */
it("Resource.layer handle: status.changes emits live counts on enqueue", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const collected = yield* Effect.forkChild(
        Effect.gen(function* () {
          const q = yield* LiveQueue;
          return yield* Stream.runCollect(
            Stream.takeUntil(q.status.changes, (s) => s.sizes.normal >= 1),
          );
        }),
      );
      yield* Effect.sleep(Duration.millis(20));
      const q = yield* LiveQueue;
      yield* q.add({ n: 1 });
      const snaps = Array.from(yield* Fiber.join(collected));
      const last = snaps[snaps.length - 1];
      expect(last?.sizes.normal).toBe(1);
      expect((yield* q.status.get).sizes.normal).toBe(1);
      expect(q.metrics.live).toBeDefined();
      expect(q.logs.live).toBeDefined();
    }).pipe(
      Effect.provide(
        QueueResource.layer(LiveQueue, {
          effect: (_item) => Effect.void,
          paused: true,
          concurrency: 1,
        }),
      ),
      Effect.scoped,
    ),
  ));
