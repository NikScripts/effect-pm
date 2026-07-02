import { Effect, Schema, Stream } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `effect` and `stream` now accept a **single schema** payload — a `Struct` value or a bare (non-struct)
// schema — exactly like `effectFn` and Effect's `Rpc.make`, not only the loose-fields shorthand. (A union
// payload, the queue `add(item | item[])` case, is likewise a single schema — exercised by the queue tests.)
class Svc extends Resource.Tag<Svc>()("payload-test/Svc", {
  // effect + a single Struct schema payload (parameterized query → a function)
  find: Resource.effect(Schema.String, {
    payload: Schema.Struct({ id: Schema.String }),
  }),
  // effect + a bare, non-struct schema payload
  len: Resource.effect(Schema.Number, { payload: Schema.String }),
  // stream + a single Struct schema payload
  since: Resource.stream(Schema.Number, {
    payload: Schema.Struct({ from: Schema.Number }),
  }),
}) {}

it("effect/stream accept single-schema payloads (Struct + bare)", () =>
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
