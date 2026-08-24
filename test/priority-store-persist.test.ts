import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Schema } from "effect";
import * as WorkPool from "../src/WorkPool";
import { Storage } from "../src/Store";
import { builtInQueueStoreContract } from "../src/internal/store/workPoolStoreSpec";

const jobSchema = Schema.Struct({ id: Schema.String });

class Jobs extends WorkPool.priority<Jobs>()("@app/CustomJobs", {
  payload: jobSchema,
  laneCount: 3,
  namedLanes: { urgent: 0 },
}) {}

class FailingJobs extends WorkPool.priority<FailingJobs>()("@app/FailingCustomJobs", {
  payload: jobSchema,
  laneCount: 2,
}) {}

describe("WorkPool.priority → baked store persistence", () => {
  it.live("persists lifecycle events to the baked-in store, readable back", () =>
    Effect.gen(function* () {
      const queue = yield* Jobs;
      yield* queue.add({ id: "j1" }, "urgent");
      yield* queue.add({ id: "j2" });

      const bridge = yield* Storage;
      const store = yield* bridge.at(
        "@app/CustomJobs",
        builtInQueueStoreContract(Jobs),
      );

      yield* Effect.gen(function* () {
        while (
          (yield* store.events()).filter((e) => e._tag === "Completed").length < 2
        ) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const tags = (yield* store.events()).map((e) => e._tag);
      expect(tags).toContain("Enqueued");
      expect(tags).toContain("Started");
      expect(tags).toContain("Completed");
    }).pipe(
      Effect.provide(
        WorkPool.layerMemory(Jobs, {
          laneCount: 3,
          namedLanes: { urgent: 0 },
          effect: () => Effect.void,
                  }),
      ),
      Effect.scoped,
    ),
  );

  it.live("records failures + retry-exhaustion through the narrow semantic writes", () =>
    Effect.gen(function* () {
      const queue = yield* FailingJobs;
      yield* queue.add({ id: "boom" });

      const bridge = yield* Storage;
      const store = yield* bridge.at(
        "@app/FailingCustomJobs",
        builtInQueueStoreContract(FailingJobs),
      );

      yield* Effect.gen(function* () {
        while (
          (yield* store.events()).filter((e) => e._tag === "RetryExhausted").length < 1
        ) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const tags = (yield* store.events()).map((e) => e._tag);
      expect(tags).toContain("Started");
      expect(tags).toContain("Failed");
      expect(tags).toContain("RetryExhausted");
    }).pipe(
      Effect.provide(
        WorkPool.layerMemory(FailingJobs, {
          laneCount: 2,
          effect: () => Effect.fail("boom" as const),
          attempts: 1,
                  }),
      ),
      Effect.scoped,
    ),
  );
});
