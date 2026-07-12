import { Effect, Schema, Stream } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// Parameterized reads use `effectFn` (or `stream` for push sources) — `effect` is inputless only.
class Svc extends Resource.Tag<Svc>()("payload-test/Svc", {
  find: Resource.effectFn(Schema.Struct({ id: Schema.String }), Schema.String),
  len: Resource.effectFn(Schema.String, Schema.Number),
  since: Resource.stream(Schema.Number, {
    payload: Schema.Struct({ from: Schema.Number }),
  }),
}) {}

it("effectFn/stream accept single-schema payloads (Struct + bare)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const p = yield* Svc;
      expect(yield* p.find({ id: "x" })).toBe("found:x");
      expect(yield* p.len("hello")).toBe(5);
      const seen = yield* Stream.runCollect(p.since({ from: 2 }));
      expect(Array.from(seen)).toEqual([2, 3, 4]);
    }).pipe(
      Effect.provide(
        Resource.layer(Svc, {
          find: ({ id }) => Effect.succeed(`found:${id}`),
          len: (s) => Effect.succeed(s.length),
          since: ({ from }) => Stream.make(from, from + 1, from + 2),
        }),
      ),
      Effect.scoped,
    ),
  ));
