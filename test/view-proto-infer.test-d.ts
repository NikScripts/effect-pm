import type * as React from "react";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as Views from "../src/ui/Views";
const Handle = Views.Card.Tag<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(Handle.annotations.size).toEqualTypeOf<Views.CardKind>();

class PoolCard extends Views.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(PoolCard.annotations.size).toEqualTypeOf<Views.CardKind>();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<Views.ViewProps>();
expectTypeOf<View.PropsOf<PoolCard>>().toEqualTypeOf<Views.ViewProps>();
expectTypeOf<PoolCard["Service"]>().toEqualTypeOf<View.View<Views.ViewProps>>();

// Svc type is View.View (defaults to {})
type ChromeSkin = View.View<Views.ViewProps>;
type TypedSkin = PoolCard["Service"];
expectTypeOf<ChromeSkin>().toEqualTypeOf<
  (props: Views.ViewProps) => React.ReactElement | null
>();
expectTypeOf<TypedSkin>().toEqualTypeOf<ChromeSkin>();
