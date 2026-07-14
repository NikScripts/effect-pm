import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as RunResource from "../src/RunResource";
import * as Store from "../src/Store";

class PriceGate extends RunResource.Tag<{ readonly _tag: "PriceGate" }>()("@test/AnalyticsPriceGate", {
  payload: Schema.Number,
  success: Schema.Number,
  error: Schema.String,
}) {}

const registration = RunResource.store(PriceGate);

class PriceStore extends Store.Service<PriceStore>("@test/AnalyticsPriceStore")(
  registration,
) {}

describe("RunResource.store — analytics read-extension", () => {
  it.effect("derivations compute over seeded run facts", () =>
    Effect.gen(function* () {
      const store = yield* PriceStore;

      yield* store.record({
        _tag: "Started",
        id: "r1/Started/1",
        resourceId: PriceGate.key,
        runId: "r1",
        occurredAt: 1,
        concurrency: 2,
      });
      yield* store.record({
        _tag: "Completed",
        id: "r1/Completed/1",
        resourceId: PriceGate.key,
        runId: "r1",
        occurredAt: 2,
        durationMs: 50,
        success: 10,
      });
      yield* store.record({
        _tag: "Started",
        id: "r2/Started/1",
        resourceId: PriceGate.key,
        runId: "r2",
        occurredAt: 3,
        concurrency: 2,
      });
      yield* store.record({
        _tag: "Failed",
        id: "r2/Failed/1",
        resourceId: PriceGate.key,
        runId: "r2",
        occurredAt: 4,
        durationMs: 20,
        error: "bad",
      });

      const stats = yield* store.stats();
      expect(stats).toEqual({ started: 2, completed: 1, failed: 1 });

      expect(yield* store.failureRate()).toBe(0.5);
      expect(yield* store.meanDurationMs()).toBe(50);

      const completed = yield* store.completed();
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ runId: "r1", success: 10 });

      const failed = yield* store.failed();
      expect(failed[0]?.error).toBe("bad");

      const history = yield* store.history("r2");
      expect(history.map((row) => row._tag)).toEqual(["Started", "Failed"]);

      const factsForR2 = yield* store.facts({ where: { runId: "r2" } });
      expect(factsForR2.map((row) => row._tag)).toEqual(["Started", "Failed"]);

      const recent = yield* store.recent(2);
      expect(recent.map((row) => row._tag)).toEqual(["Started", "Failed"]);

      const last = yield* store.lastFailure();
      expect(Option.isSome(last)).toBe(true);
      if (Option.isSome(last)) {
        expect(last.value.runId).toBe("r2");
      }
    }).pipe(Effect.provide(PriceStore.layerMemory), Effect.scoped),
  );
});
