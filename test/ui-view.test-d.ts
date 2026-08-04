/**
 * View.Service reversed props + Views.react R = never.
 */
import { Effect, Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

import * as Views from "../src/ui/Views";
class PoolCard extends Views.Card.Service<PoolCard>()("hyperlink/view/pool-card") {}
class CustomCard extends Views.Card.Service<CustomCard>()("hyperlink/view/custom-card") {}

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Service<Jobs>()("app/Jobs", { payload: Item }) {}

declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

const provided = Views.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(View.succeed(PoolCard, (_props) => null)),
  Layer.provideMerge(Views.base),
);

runFullyWired(provided);
Views.react(provided);

const missingProvide = Views.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(Views.base),
);

type MissingR = Layer.Services<typeof missingProvide>;
expectTypeOf<[MissingR] extends [never] ? true : false>().toEqualTypeOf<false>();
expectTypeOf<MissingR>().toEqualTypeOf<PoolCard>();

// provide props = Prototype Props (reversed)
View.succeed(PoolCard, (props) => {
  expectTypeOf(props).toEqualTypeOf<Views.ViewProps>();
  expectTypeOf(props).toEqualTypeOf<View.Type<typeof PoolCard>>();
  return null;
});

// dual + Tag.provide
View.succeed(PoolCard)((props) => {
  expectTypeOf(props).toEqualTypeOf<Views.ViewProps>();
  return null;
});
PoolCard.provide((props) => {
  expectTypeOf(props).toEqualTypeOf<Views.ViewProps>();
  return null;
});

expectTypeOf(View.getAnnotations(PoolCard).size).toEqualTypeOf<Views.CardKind>();
expectTypeOf(View.annotations(PoolCard)).toEqualTypeOf<
  Effect.Effect<{ readonly size: Views.CardKind }>
>();

const withOnly = Layer.mergeAll(
  Views.bind(WorkPool.kind, PoolCard),
  Views.only(Jobs, CustomCard),
).pipe(Layer.provideMerge(Views.base));

type OnlyMissingR = Layer.Services<typeof withOnly>;
expectTypeOf<OnlyMissingR>().toEqualTypeOf<PoolCard | CustomCard>();

const kit = Views.react(provided);
const bound = kit.for(Jobs);
expectTypeOf(bound.Card).toBeFunction();
expectTypeOf<Parameters<typeof bound.Card>[0]>().toEqualTypeOf<Views.BoundViewProps>();
