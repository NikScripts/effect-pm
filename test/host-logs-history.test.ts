import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { NodeLogs } from "../src";
import { LogAnnotationKeys } from "../src/LogContext";
import * as ProcessStorage from "../src/ProcessStorage";
import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

// NodeLogs.layer (runtime-wide capture + relay) + persistLayer(node) → durable LogStore (memory
// backend via ProcessStorage). Bare Effect.log* lines are captured, batched, persisted bucketed by
// node key (`Resource.Node.key`), and readable **by node** or **by resource**.
const storage = NodeLogs.persistLayer(testBillingNodeKey).pipe(
  Layer.provideMerge(Layer.mergeAll(NodeLogs.layer, ProcessStorage.layer)),
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
        while ((yield* NodeLogs.byNode(testBillingNodeKey)).length < 2) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const nodeRows = yield* NodeLogs.byNode(testBillingNodeKey, { limit: 50 });
      expect(nodeRows.length).toBeGreaterThanOrEqual(2);
      // every stored line carries the node annotation (the bucket)
      expect(
        nodeRows.every(
          (row) => row.annotations[LogAnnotationKeys.node] === testBillingNodeKey,
        ),
      ).toBe(true);
      expect(nodeRows.some((row) => row.message.includes("node-wide line"))).toBe(true);

      // by resource: only the line annotated with that processId
      const workerRows = yield* NodeLogs.byResource({ processId: testSyncProcessKey });
      expect(workerRows.length).toBe(1);
      expect(workerRows[0]?.message).toBe("worker line");
    }).pipe(Effect.provide(storage), Effect.scoped),
  ));

it("byResource is empty for a resource with no logs (graceful, not an error)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(yield* NodeLogs.byResource({ queueId: "never" })).toEqual([]);
    }).pipe(Effect.provide(storage), Effect.scoped),
  ));
