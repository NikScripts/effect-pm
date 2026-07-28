/**
 * View.Tag reversed props + View.react R = never.
 */
import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
class CustomCard extends View.Card.Tag<CustomCard>()("hyperlink/view/custom-card") {}

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}

declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

const provided = View.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(
    Layer.succeed(PoolCard, (_props: View.Type<typeof PoolCard>) => null),
  ),
  Layer.provideMerge(View.base),
);

runFullyWired(provided);
View.react(provided);

const missingProvide = View.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(View.base),
);

type MissingR = Layer.Services<typeof missingProvide>;
expectTypeOf<[MissingR] extends [never] ? true : false>().toEqualTypeOf<false>();
expectTypeOf<MissingR>().toEqualTypeOf<PoolCard>();

// succeed props = Prototype Props (reversed)
Layer.succeed(PoolCard, (props) => {
  expectTypeOf(props).toEqualTypeOf<View.ViewProps>();
  expectTypeOf(props).toEqualTypeOf<View.Type<typeof PoolCard>>();
  return null;
});

expectTypeOf(PoolCard.size).toEqualTypeOf<View.CardKind>();

const withOnly = Layer.mergeAll(
  View.bind(WorkPool.kind, PoolCard),
  View.only(Jobs, CustomCard),
).pipe(Layer.provideMerge(View.base));

type OnlyMissingR = Layer.Services<typeof withOnly>;
expectTypeOf<OnlyMissingR>().toEqualTypeOf<PoolCard | CustomCard>();

const kit = View.react(provided);
const bound = kit.for(Jobs);
expectTypeOf(bound.Card).toBeFunction();
expectTypeOf<Parameters<typeof bound.Card>[0]>().toEqualTypeOf<View.BoundViewProps>();
