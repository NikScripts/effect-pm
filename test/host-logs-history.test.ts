import { Duration, Effect } from "effect";
import { expect, it } from "vitest";
import * as Logs from "../src/Logs";
import { LogAnnotationKeys } from "../src/LogContext";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

class BillingNode extends Resource.Node<BillingNode>(testBillingNodeKey) {}

class SyncProc extends Process.Tag<SyncProc>()(testSyncProcessKey).pipe(
  Process.schedule([]),
) {}

class AppStore extends Store.Service<AppStore>("@test/host-logs/Store")(
  BillingNode.logs,
  Process.store(SyncProc),
) {}

it("persists runtime logs bucketed by node — readable by node and by resource", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("node-wide line");
      yield* Effect.logInfo("worker line").pipe(Logs.withScope(SyncProc));

      yield* Effect.gen(function* () {
        while (
          (yield* Logs.byNode(BillingNode)).length < 2 ||
          !(yield* Logs.byResource({ processId: testSyncProcessKey })).some(
            (row) => row.message === "worker line",
          )
        ) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const nodeRows = yield* Logs.byNode(BillingNode, { limit: 50 });
      expect(nodeRows.length).toBeGreaterThanOrEqual(2);
      expect(
        nodeRows.every(
          (row) => row.annotations[LogAnnotationKeys.node] === testBillingNodeKey,
        ),
      ).toBe(true);
      expect(nodeRows.some((row) => row.message.includes("node-wide line"))).toBe(true);

      const workerRows = yield* Logs.byResource({ processId: testSyncProcessKey });
      expect(workerRows.some((row) => row.message === "worker line")).toBe(true);
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  ));

it("byResource is empty for a resource with no logs (graceful, not an error)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(yield* Logs.byResource({ queueId: "never" })).toEqual([]);
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  ));
