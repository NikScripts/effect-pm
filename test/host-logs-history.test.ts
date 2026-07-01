import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { HostLogs } from "../src";
import { LogAnnotationKeys } from "../src/LogContext";
import { ProcessStorage } from "../src/ProcessStorage";

// HostLogs.layer (runtime-wide capture + relay) + persistLayer(host) → durable LogStore (memory
// backend via ProcessStorage). Bare Effect.log* lines are captured, batched, persisted bucketed by
// host, and readable **by host** or **by resource**.
const HOST = "wnba";
const storage = HostLogs.persistLayer(HOST).pipe(
  Layer.provideMerge(Layer.mergeAll(HostLogs.layer, ProcessStorage.layer)),
);

it("persists runtime logs bucketed by host — readable by host and by resource", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("host-wide line");
      yield* Effect.annotateLogs(Effect.logInfo("worker line"), {
        [LogAnnotationKeys.processId]: "worker-1",
      });

      // the persist writer batches on a ~250ms window — poll until both lines land
      yield* Effect.gen(function* () {
        while ((yield* HostLogs.byHost(HOST)).length < 2) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const hostRows = yield* HostLogs.byHost(HOST, { limit: 50 });
      expect(hostRows.length).toBeGreaterThanOrEqual(2);
      // every stored line carries the host annotation (the bucket)
      expect(
        hostRows.every((row) => row.annotations[LogAnnotationKeys.host] === HOST),
      ).toBe(true);
      expect(hostRows.some((row) => row.message.includes("host-wide line"))).toBe(true);

      // by resource: only the line annotated with that processId
      const workerRows = yield* HostLogs.byResource({ processId: "worker-1" });
      expect(workerRows.length).toBe(1);
      expect(workerRows[0]?.message).toBe("worker line");
    }).pipe(Effect.provide(storage), Effect.scoped),
  ));

it("byResource is empty for a resource with no logs (graceful, not an error)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(yield* HostLogs.byResource({ queueId: "never" })).toEqual([]);
    }).pipe(Effect.provide(storage), Effect.scoped),
  ));
