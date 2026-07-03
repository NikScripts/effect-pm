import { Effect, Option, Schema, Stream } from "effect";
import { expect, it } from "@effect/vitest";
import { CustomQueueResource } from "../src";
import * as Resource from "../src/Resource";
import { methodMeta, specOf } from "../src/Resource";

const JobSchema = Schema.Struct({ id: Schema.String });

it("customQueueTag bakes named levels and pair-style add", () => {
  class Jobs extends CustomQueueResource.Tag<Jobs>()(
    "@app/Jobs-spec",
    JobSchema,
    4,
    { urgent: 0, batch: 3 },
  ) {}

  const spec = specOf(Jobs);
  const addMeta = methodMeta(spec.add);
  expect(addMeta.description).toContain("lane");
  expect(spec.add.annotations.callStyle).toBe("pair");
});

it("customQueueTag accepts level names as a string array", () => {
  class Jobs extends CustomQueueResource.Tag<Jobs>()(
    "@app/Jobs-names",
    JobSchema,
    ["urgent", "normal", "batch"],
  ) {}

  const spec = specOf(Jobs);
  expect(spec.add.annotations.callStyle).toBe("pair");
});

it.live("customQueueResource.layer drives add(item, level)", () =>
  Effect.gen(function* () {
    class Jobs extends CustomQueueResource.Tag<Jobs>()(
      "@app/Jobs-layer",
      JobSchema,
      3,
      { fast: 2 },
    ) {}

    const program = Effect.gen(function* () {
      const queue = yield* Jobs;
      yield* queue.add({ id: "a" }, "fast");
      // observe the live status delta stream until the "fast" lane reflects the enqueue.
      const snap = yield* Stream.runHead(
        Stream.filter(
          Resource.changes(queue, (s) => s.status),
          (s) => s.sizes.fast === 1,
        ),
      );
      expect(Option.getOrThrow(snap).sizes.fast).toBe(1);
    });

    yield* program.pipe(
      Effect.provide(
        CustomQueueResource.layer(Jobs, {
          levelCount: 3,
          namedLevels: { fast: 2 },
          effect: () => Effect.void,
          autoStart: false,
        }),
      ),
    );
  }).pipe(Effect.scoped),
);
