import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { LogAnnotationKeys } from "../src/LogContext";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";

class BillingNode extends Resource.Node<BillingNode>("test/two-copies/node") {}
class SyncProc extends Process.Tag<SyncProc>()("test/two-copies/proc") {}

class QuietProc extends Process.Tag<QuietProc>()("test/stream-level/quiet").pipe(
  Resource.logStreamLevelWarn,
) {}

class RegProc extends Process.Tag<RegProc>()("test/stream-level/reg") {}

class TwoCopyStore extends Store.Service<TwoCopyStore>("@test/logs-two-copies/Store")(
  BillingNode.logs,
  Process.store(SyncProc),
) {}

class TagStreamStore extends Store.Service<TagStreamStore>("@test/logs-tag-stream/Store")(
  Process.store(QuietProc),
) {}

class RegStreamStore extends Store.Service<RegStreamStore>("@test/logs-reg-stream/Store")(
  Process.store(RegProc).pipe(Store.streamLevelWarn),
) {}

describe("node + resource durable copies", () => {
  it.effect("same lineId lands in both node journal and resource scope", () =>
    Effect.gen(function* () {
      yield* Effect.logInfo("shared-line").pipe(Logs.withScope(SyncProc));
      yield* Effect.gen(function* () {
        while ((yield* Logs.byNode(BillingNode)).length === 0) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const nodeRows = yield* Logs.byNode(BillingNode, { limit: 50 });
      const resourceRows = yield* Logs.byResource({ processId: SyncProc.key });
      const shared = nodeRows.find((row) => row.message === "shared-line");
      expect(shared).toBeDefined();
      const lineId = shared?.annotations[LogAnnotationKeys.lineId];
      expect(typeof lineId).toBe("string");
      expect(
        resourceRows.some(
          (row) =>
            row.message === "shared-line" &&
            row.annotations[LogAnnotationKeys.lineId] === lineId,
        ),
      ).toBe(true);
    }).pipe(Effect.provide(TwoCopyStore.layerMemory), Effect.scoped),
  );
});

describe("Resource.logStreamLevel / Store.streamLevel", () => {
  it.effect("logStreamLevelWarn drops Info on live Resource.logs stream", () =>
    Effect.gen(function* () {
      const { stream } = yield* Resource.logs(QuietProc);
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(stream, 1)),
      );
      yield* Effect.yieldNow;
      yield* Effect.logInfo("ignored-info").pipe(Logs.withScope(QuietProc));
      yield* Effect.logWarning("kept-warn").pipe(Logs.withScope(QuietProc));
      const live = Array.from(yield* Fiber.join(collected))[0];
      expect(live?.message).toBe("kept-warn");
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          TagStreamStore.layerMemory,
          Process.layer(QuietProc, { effect: Effect.void }),
        ),
      ),
      Effect.scoped,
    ),
  );

  it.effect("Store.streamLevelWarn stamps tag for Resource.logs", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      yield* TestClock.adjust(Duration.millis(1));
      const { stream } = yield* Resource.logs(RegProc);
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(stream, 1)),
      );
      yield* Effect.yieldNow;
      yield* relay.publish({
        date: "1970-01-01T00:00:00.000Z",
        level: "Info",
        message: "reg-info",
        annotations: {
          [LogAnnotationKeys.lineage]: JSON.stringify([RegProc.key]),
        },
        spans: [],
      });
      yield* relay.publish({
        date: "1970-01-01T00:00:00.000Z",
        level: "Warn",
        message: "reg-warn",
        annotations: {
          [LogAnnotationKeys.lineage]: JSON.stringify([RegProc.key]),
        },
        spans: [],
      });
      const live = Array.from(yield* Fiber.join(collected))[0];
      expect(live?.message).toBe("reg-warn");
    }).pipe(Effect.provide(RegStreamStore.layerMemory), Effect.scoped),
  );
});
