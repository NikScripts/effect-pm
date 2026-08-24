import { Effect, Schema, Stream } from "effect";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";

class Counter extends Hyperlink.Service<Counter>()("promise-d/Counter", {
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  maxSize: Hyperlink.value(Schema.Number),
  count: Hyperlink.ref(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
  admin: {
    ping: Hyperlink.effect(Schema.String),
  },
}) {}

type Handle = Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Counter>, Counter>;
type Api = Hyperlink.PromiseOf<Handle>;

expectTypeOf<Api["current"]>().toEqualTypeOf<Promise<number>>();
expectTypeOf<Api["add"]>().toEqualTypeOf<(by: number) => Promise<number>>();
expectTypeOf<Api["maxSize"]>().toEqualTypeOf<number>();
expectTypeOf<Api["count"]>().toEqualTypeOf<Hyperlink.PromiseSubscribable<number>>();
expectTypeOf<Api["ticks"]>().toEqualTypeOf<AsyncIterable<number>>();
expectTypeOf<Api["admin"]["ping"]>().toEqualTypeOf<Promise<string>>();

// Handle Effects stay Effects — adapter is opt-in.
expectTypeOf<Handle["current"]>().toEqualTypeOf<Effect.Effect<number>>();
expectTypeOf<Handle["ticks"]>().toEqualTypeOf<Stream.Stream<number>>();
