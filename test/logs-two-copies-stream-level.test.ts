import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { LogAnnotationKeys } from "../src/LogContext";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import * as Node from "../src/Node";

class BillingNode extends Node.Tag<BillingNode>("test/two-copies/node") {}
class SyncProc extends Process.Tag<SyncProc>()("test/two-copies/proc") {}

class QuietProc extends Process.Tag<QuietProc>()("test/stream-level/quiet") {}
const QuietProcWithStreamLevel = Resource.logStreamLevelWarn(QuietProc);

class RegProc extends Process.Tag<RegProc>()("test/stream-level/reg") {}

const syncRegistration = Process.store(SyncProc);
class TwoCopyStore extends Store.Service<TwoCopyStore>("@test/logs-two-copies/Store")(
  BillingNode.logs,
  syncRegistration,
) {}

const quietRegistration = Process.store(QuietProcWithStreamLevel);
class TagStreamStore extends Store.Service<TagStreamStore>("@test/logs-tag-stream/Store")(
  quietRegistration,
) {}

const regStreamRegistration = Process.store(RegProc).pipe(Store.streamLevelWarn);
class RegStreamStore extends Store.Service<RegStreamStore>("@test/logs-reg-stream/Store")(
  regStreamRegistration,
) {}

const lineageOf = (key: string): string => `["${key}"]`;

describe("node + resource durable copies", () => {
  it("same lineId lands in both node journal and resource scope", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logInfo("shared-line").pipe(Logs.withScope(SyncProc));
        yield* Effect.gen(function* () {
          while (true) {
            const nodeRows = yield* Logs.byNode(BillingNode, { limit: 50 });
            const resourceRows = yield* Logs.byResource(SyncProc.key,);
            const shared = nodeRows.find((row) => row.message === "shared-line");
            const lineId = shared?.annotations[LogAnnotationKeys.lineId];
            if (
              typeof lineId === "string" &&
              resourceRows.some(
                (row) =>
                  row.message === "shared-line" &&
                  row.annotations[LogAnnotationKeys.lineId] === lineId,
              )
            ) {
              expect(shared).toBeDefined();
              return;
            }
            yield* Effect.sleep(Duration.millis(20));
          }
        }).pipe(Effect.timeout(Duration.seconds(3)));
      }).pipe(Effect.provide(TwoCopyStore.layerMemory), Effect.scoped),
    ));
});

describe("Resource.logStreamLevel / Store.streamLevel", () => {
  it("logStreamLevelWarn drops Info on live Resource.logs stream", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stream } = yield* Resource.logs(QuietProcWithStreamLevel);
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
          Process.layer(QuietProc, { effect: Effect.void }).pipe(
            Layer.provideMerge(TagStreamStore.layerMemory),
          ),
        ),
        Effect.scoped,
      ),
    ));

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
          [LogAnnotationKeys.lineage]: lineageOf(RegProc.key),
        },
        spans: [],
      });
      yield* relay.publish({
        date: "1970-01-01T00:00:00.000Z",
        level: "Warn",
        message: "reg-warn",
        annotations: {
          [LogAnnotationKeys.lineage]: lineageOf(RegProc.key),
        },
        spans: [],
      });
      const live = Array.from(yield* Fiber.join(collected))[0];
      expect(live?.message).toBe("reg-warn");
    }).pipe(Effect.provide(RegStreamStore.layerMemory), Effect.scoped),
  );
});
