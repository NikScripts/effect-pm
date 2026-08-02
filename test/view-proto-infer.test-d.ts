import type * as React from "react";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
const Handle = View.Card.Tag<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(Handle.size).toEqualTypeOf<View.CardKind>();

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(PoolCard.size).toEqualTypeOf<View.CardKind>();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<View.ViewProps>();
expectTypeOf<View.PropsOf<PoolCard>>().toEqualTypeOf<View.ViewProps>();
expectTypeOf<PoolCard["Service"]>().toEqualTypeOf<View.View<View.ViewProps>>();

// Svc type is View.View (defaults to {})
type ChromeSkin = View.View<View.ViewProps>;
type TypedSkin = PoolCard["Service"];
expectTypeOf<ChromeSkin>().toEqualTypeOf<
  (props: View.ViewProps) => React.ReactElement | null
>();
expectTypeOf<TypedSkin>().toEqualTypeOf<ChromeSkin>();
