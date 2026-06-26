import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { HistoryStore, HostLogs } from "../src";

// Runtime-wide log capture (HostLogs.layer) + the persist tap (HostLogs.persistLayer) + an
// in-memory HistoryStore. A bare Effect.logInfo anywhere under this layer is captured, appended,
// and readable via HostLogs.history.
const persisted = HostLogs.persistLayer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(HostLogs.layer, HistoryStore.layerMemory()),
  ),
);

it("HostLogs.history reads back persisted runtime logs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("hello from host logs");
      // the persist tap appends asynchronously — wait until history is populated
      yield* Effect.gen(function* () {
        while ((yield* HostLogs.history()).length === 0) {
          yield* Effect.sleep(Duration.millis(10));
        }
      }).pipe(Effect.timeout(Duration.seconds(2)));

      const rows = yield* HostLogs.history({ limit: 50 });
      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.some((r) => JSON.stringify(r).includes("hello from host logs")),
      ).toBe(true);
    }).pipe(Effect.provide(persisted), Effect.scoped),
  ));

it("HostLogs.history is empty without a HistoryStore (graceful, opt-in)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("not persisted");
      expect(yield* HostLogs.history()).toEqual([]);
    }).pipe(Effect.provide(HostLogs.layer), Effect.scoped),
  ));
