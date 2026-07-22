import { Effect, Option, Schema, Stream } from "effect";
import { expect, it } from "@effect/vitest";
import { CustomQueueHyperlink } from "../src";
import { methodMeta, specOf } from "../src/Hyperlink";

const JobSchema = Schema.Struct({ id: Schema.String });

it("customQueueTag bakes named levels and pair-style add", () => {
  class Jobs extends CustomQueueHyperlink.Tag<Jobs>()("@app/Jobs-spec", {
    payload: JobSchema,
    levelCount: 4,
    namedLevels: { urgent: 0, batch: 3 },
  }) {}

  const spec = specOf(Jobs);
  const addMeta = methodMeta(spec.add);
  expect(addMeta.description).toContain("lane");
  expect(spec.add.annotations.callStyle).toBe("pair");
});

it("customQueueTag bakes named levels from the config object", () => {
  class Jobs extends CustomQueueHyperlink.Tag<Jobs>()("@app/Jobs-names", {
    payload: JobSchema,
    levelCount: 3,
    namedLevels: { urgent: 0, normal: 1, batch: 2 },
  }) {}

  const spec = specOf(Jobs);
  expect(spec.add.annotations.callStyle).toBe("pair");
});

it.live("customQueueHyperlink.layer drives add(item, level)", () =>
  Effect.gen(function* () {
    class Jobs extends CustomQueueHyperlink.Tag<Jobs>()("@app/Jobs-layer", {
      payload: JobSchema,
      levelCount: 3,
      namedLevels: { fast: 2 },
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
        CustomQueueHyperlink.layerMemory(Jobs, {
          levelCount: 3,
          namedLevels: { fast: 2 },
          effect: () => Effect.void,
          autoStart: false,
        }),
      ),
    );
  }).pipe(Effect.scoped),
);
