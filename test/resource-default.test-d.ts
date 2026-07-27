/**
 * Type-level assertions for {@link Hyperlink.default} / {@link Hyperlink.defaults}.
 */
import { Effect, Schema } from "effect";
import { expectTypeOf } from "vitest";
import type { DefaultMethod, ImplOf, Wire, WithDefaults } from "../src/Hyperlink";
import * as Hyperlink from "../src/Hyperlink";

class Counter extends Hyperlink.Tag<Counter>()("default-d/Counter", {
  current: Hyperlink.effect(Schema.Number),
  label: Hyperlink.default((n: number) => `count=${n}`),
  unit: Hyperlink.default("count" as const),
  admin: {
    banner: Hyperlink.default((name: string) => `hello ${name}`),
  },
}) {}

type Handle = Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Counter>, Counter>;
type Impl = ImplOf<Hyperlink.SpecOf<typeof Counter>>;
type WireHandle = Wire<Hyperlink.SpecOf<typeof Counter>>;

expectTypeOf<Handle["label"]>().toEqualTypeOf<(n: number) => string>();
expectTypeOf<Handle["unit"]>().toEqualTypeOf<"count">();
expectTypeOf<Handle["admin"]["banner"]>().toEqualTypeOf<(name: string) => string>();
expectTypeOf<Handle["current"]>().toEqualTypeOf<Effect.Effect<number>>();

// default is omitted from impl — wire members + empty default-only nests.
expectTypeOf<keyof Impl>().toEqualTypeOf<"current" | "admin">();
expectTypeOf<Impl["admin"]>().toEqualTypeOf<{}>();

// Wire strips Tag-baked default *leaves*; a default-only nest remains as `{}`.
expectTypeOf<keyof WireHandle>().toEqualTypeOf<"current" | "admin">();
expectTypeOf<WireHandle["admin"]>().toEqualTypeOf<{}>();

const _leaf: DefaultMethod<(n: number) => string> = Hyperlink.default(
  (n: number) => `count=${n}`,
);
void _leaf;

declare const asyncLabel: (n: number) => Promise<string>;
// @ts-expect-error Promise-returning fn is rejected (sync defaults only)
Hyperlink.default(asyncLabel);

declare const asyncBag: { readonly bad: () => Promise<string> };
// @ts-expect-error Promise-returning fn rejected in defaults bag too
Hyperlink.defaults(asyncBag);

class Adorned extends Hyperlink.Tag<Adorned>()("default-d/Adorned", {
  current: Hyperlink.effect(Schema.Number),
}).pipe(
  Hyperlink.defaults({
    label: (n: number) => `n=${n}`,
  }),
) {}

// layer accepts defaults bag overrides (structural)
Hyperlink.layer(Adorned, {
  current: Effect.succeed(1),
  label: (n: number) => `x=${n}`,
});

// precise bag on the Tag; handle widen via WithDefaults
type AdornedBag = Hyperlink.DefaultsOf<typeof Adorned>;
expectTypeOf<AdornedBag["label"]>().toEqualTypeOf<(n: number) => string>();
expectTypeOf<WithDefaults<typeof Adorned>["label"]>().toEqualTypeOf<
  (n: number) => string
>();

// Spec default leaf override on layer impl
Hyperlink.layer(Counter, {
  current: Effect.succeed(1),
  admin: {},
  label: (n: number) => `x=${n}`,
});

// double-pipe merges bag types (data-first to avoid chained `.pipe` diagnostic)
class Double extends Hyperlink.defaults(
  Hyperlink.defaults(
    Hyperlink.Tag<Double>()("default-d/Double", {
      current: Hyperlink.effect(Schema.Number),
    }),
    { a: 1 as const },
  ),
  { b: 2 as const },
) {}
type DoubleBag = Hyperlink.DefaultsOf<typeof Double>;
expectTypeOf<DoubleBag["a"]>().toEqualTypeOf<1>();
expectTypeOf<DoubleBag["b"]>().toEqualTypeOf<2>();
