import { Effect, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";

class Counter extends Hyperlink.Tag<Counter>()("pure-d/Counter", {
  current: Hyperlink.effect(Schema.Number),
  label: Hyperlink.pure((n: number) => `count=${n}`),
  admin: {
    banner: Hyperlink.pure((name: string) => `hello ${name}`),
  },
}) {}

type Handle = Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Counter>, Counter>;
type Impl = Hyperlink.ImplOf<Hyperlink.SpecOf<typeof Counter>>;
type Wire = Hyperlink.Wire<Hyperlink.SpecOf<typeof Counter>>;

expectTypeOf<Handle["label"]>().toEqualTypeOf<(n: number) => string>();
expectTypeOf<Handle["admin"]["banner"]>().toEqualTypeOf<(name: string) => string>();
expectTypeOf<Handle["current"]>().toEqualTypeOf<Effect.Effect<number>>();

// pure is omitted from impl — wire members + empty pure-only nests.
expectTypeOf<keyof Impl>().toEqualTypeOf<"current" | "admin">();
expectTypeOf<Impl["admin"]>().toEqualTypeOf<{}>();

// pure leaves stay off the wire; a pure-only nest remains as `{}` (same compromise as ImplOf).
expectTypeOf<keyof Wire>().toEqualTypeOf<"current" | "admin">();
expectTypeOf<Wire["admin"]>().toEqualTypeOf<{}>();

// Promise-returning fn rejected at the call.
declare const asyncFn: (n: number) => Promise<number>;
// @ts-expect-error pure must be synchronous
Hyperlink.pure(asyncFn);
