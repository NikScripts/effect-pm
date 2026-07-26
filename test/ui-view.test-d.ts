/**
 * View.react requires Layer R = never — assert open R via Layer.Services
 * (do not call react on an incomplete layer — that trips missingLayerContext).
 */
import { Layer } from "effect";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  kind: "card",
  spec: {},
});

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
