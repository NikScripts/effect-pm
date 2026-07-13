import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import * as Logs from "../src/Logs";
import { LogAnnotationKeys } from "../src/LogContext";
import { LogStore } from "../src/store/log";
import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

// Logs.layer (runtime-wide capture + relay) + persistLayer(node) → durable LogStore (memory).
// Bare Effect.log* lines are captured, batched, persisted bucketed by node key, and readable
// by node or by resource.
const storage = Logs.persistLayer(testBillingNodeKey).pipe(
  Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
);

it("persists runtime logs bucketed by node — readable by node and by resource", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("node-wide line");
      yield* Effect.annotateLogs(Effect.logInfo("worker line"), {
        [LogAnnotationKeys.processId]: testSyncProcessKey,
      });

      // the persist writer batches on a ~250ms window — poll until both lines land
      yield* Effect.gen(function* () {
        while ((yield* Logs.byNode(testBillingNodeKey)).length < 2) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const nodeRows = yield* Logs.byNode(testBillingNodeKey, { limit: 50 });
      expect(nodeRows.length).toBeGreaterThanOrEqual(2);
      // every stored line carries the node annotation (the bucket)
      expect(
        nodeRows.every(
          (row) => row.annotations[LogAnnotationKeys.node] === testBillingNodeKey,
        ),
      ).toBe(true);
      expect(nodeRows.some((row) => row.message.includes("node-wide line"))).toBe(true);

      // by resource: only the line annotated with that processId
      const workerRows = yield* Logs.byResource({ processId: testSyncProcessKey });
      expect(workerRows.length).toBe(1);
      expect(workerRows[0]?.message).toBe("worker line");
    }).pipe(Effect.provide(storage), Effect.scoped),
  ));

it("byResource is empty for a resource with no logs (graceful, not an error)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(yield* Logs.byResource({ queueId: "never" })).toEqual([]);
    }).pipe(Effect.provide(storage), Effect.scoped),
  ));
