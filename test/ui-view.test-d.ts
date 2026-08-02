/**
 * View.Tag reversed props + Ui.react R = never.
 */
import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as Ui from "../src/ui/Ui";
import * as WorkPool from "../src/WorkPool";

class PoolCard extends Ui.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
class CustomCard extends Ui.Card.Tag<CustomCard>()("hyperlink/view/custom-card") {}

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}

declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

const provided = Ui.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(View.provide(PoolCard, (_props) => null)),
  Layer.provideMerge(Ui.base),
);

runFullyWired(provided);
Ui.react(provided);

const missingProvide = Ui.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(Ui.base),
);

type MissingR = Layer.Services<typeof missingProvide>;
expectTypeOf<[MissingR] extends [never] ? true : false>().toEqualTypeOf<false>();
expectTypeOf<MissingR>().toEqualTypeOf<PoolCard>();

// provide props = Prototype Props (reversed)
View.provide(PoolCard, (props) => {
  expectTypeOf(props).toEqualTypeOf<Ui.ViewProps>();
  expectTypeOf(props).toEqualTypeOf<View.Type<typeof PoolCard>>();
  return null;
});

// dual + Tag.provide
View.provide(PoolCard)((props) => {
  expectTypeOf(props).toEqualTypeOf<Ui.ViewProps>();
  return null;
});
PoolCard.provide((props) => {
  expectTypeOf(props).toEqualTypeOf<Ui.ViewProps>();
  return null;
});

expectTypeOf(PoolCard.size).toEqualTypeOf<Ui.CardKind>();

const withOnly = Layer.mergeAll(
  Ui.bind(WorkPool.kind, PoolCard),
  Ui.only(Jobs, CustomCard),
).pipe(Layer.provideMerge(Ui.base));

type OnlyMissingR = Layer.Services<typeof withOnly>;
expectTypeOf<OnlyMissingR>().toEqualTypeOf<PoolCard | CustomCard>();

const kit = Ui.react(provided);
const bound = kit.for(Jobs);
expectTypeOf(bound.Card).toBeFunction();
expectTypeOf<Parameters<typeof bound.Card>[0]>().toEqualTypeOf<Ui.BoundViewProps>();
