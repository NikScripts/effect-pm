/**
 * View.react requires Layer R = never — assert open R via Layer.Services
 * (do not call react on an incomplete layer — that trips missingLayerContext).
 */
import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  kind: "card",
  spec: {},
});
const CustomCard = View.make({
  key: "hyperlink/view/custom-card",
  kind: "card",
  spec: {},
});

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}

declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

const provided = View.bindKind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(Layer.succeed(PoolCard, () => null)),
  Layer.provideMerge(View.base),
);

runFullyWired(provided);
View.react(provided);

const missingProvide = View.bindKind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(View.base),
);

type MissingR = Layer.Services<typeof missingProvide>;
expectTypeOf<[MissingR] extends [never] ? true : false>().toEqualTypeOf<false>();
expectTypeOf<MissingR>().toEqualTypeOf<View.ViewId<"hyperlink/view/pool-card">>();

// requireView adds pin-only Views to R (W20)
const withPinRequire = Layer.mergeAll(
  View.bindKind(WorkPool.kind, PoolCard),
  View.requireView(CustomCard),
).pipe(Layer.provideMerge(View.base));

type PinMissingR = Layer.Services<typeof withPinRequire>;
expectTypeOf<PinMissingR>().toEqualTypeOf<
  View.ViewId<"hyperlink/view/pool-card"> | View.ViewId<"hyperlink/view/custom-card">
>();

const kit = View.react(provided);
const bound = kit.for(Jobs);
expectTypeOf(bound.Card).toBeFunction();
expectTypeOf<Parameters<typeof bound.Card>[0]>().toEqualTypeOf<View.BoundViewProps>();
