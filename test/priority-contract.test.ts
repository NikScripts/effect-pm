import { Effect, Option, Schema, Stream } from "effect";
import { expect, it } from "@effect/vitest";
import { WorkPool } from "../src";
import * as Hyperlink from "../src/Hyperlink";
import { methodMeta, specOf } from "../src/Hyperlink";

const JobSchema = Schema.Struct({ id: Schema.String });

it("WorkPool.priority tag bakes named levels and pair-style add", () => {
  class Jobs extends WorkPool.priority<Jobs>()("@app/Jobs-spec", {
    payload: JobSchema,
    laneCount: 4,
    namedLanes: { urgent: 0, batch: 3 },
  }) {}

  const spec = specOf(Jobs);
  const addMeta = methodMeta(spec.add);
  expect(addMeta.description).toContain("lane");
  expect(spec.add.annotations.callStyle).toBe("pair");
});

it("WorkPool.priority tag bakes named levels from the config object", () => {
  class Jobs extends WorkPool.priority<Jobs>()("@app/Jobs-names", {
    payload: JobSchema,
    laneCount: 3,
    namedLanes: { urgent: 0, normal: 1, batch: 2 },
  }) {}

  const spec = specOf(Jobs);
  expect(spec.add.annotations.callStyle).toBe("pair");
});

it.live("WorkPool.layer drives add(item, lane)", () =>
  Effect.gen(function* () {
    class Jobs extends WorkPool.priority<Jobs>()("@app/Jobs-layer", {
      payload: JobSchema,
      laneCount: 3,
      namedLanes: { fast: 2 },
    }) {}

    const program = Effect.gen(function* () {
      const queue = yield* Jobs;
      yield* queue.add({ id: "a" }, "fast");
      // observe the live status delta stream until the "fast" lane reflects the enqueue.
      const snap = yield* Stream.runHead(
        Stream.filter(
          queue.status.changes,
          (s) => s.sizes.fast === 1,
        ),
      );
      expect(Option.getOrThrow(snap).sizes.fast).toBe(1);
    });

    yield* program.pipe(
      Effect.provide(
        WorkPool.layerMemory(Jobs, {
          laneCount: 3,
          namedLanes: { fast: 2 },
          effect: () => Effect.void,
        }).pipe(Hyperlink.deferStart),
      ),
    );
  }).pipe(Effect.scoped),
);
