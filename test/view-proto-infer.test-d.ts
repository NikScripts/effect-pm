import type * as React from "react";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as Views from "../src/ui/Views";
const Handle = Views.Card.Service<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(View.getAnnotations(Handle).size).toEqualTypeOf<Views.CardKind>();

class PoolCard extends Views.Card.Service<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(View.getAnnotations(PoolCard).size).toEqualTypeOf<Views.CardKind>();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<Views.ViewProps>();
expectTypeOf<View.PropsOf<PoolCard>>().toEqualTypeOf<Views.ViewProps>();
expectTypeOf<PoolCard["Service"]>().toEqualTypeOf<View.View<Views.ViewProps>>();

// Svc type is View.View (defaults to {})
type DefaultSkin = View.View<Views.ViewProps>;
type TypedSkin = PoolCard["Service"];
expectTypeOf<DefaultSkin>().toEqualTypeOf<
  (props: Views.ViewProps) => React.ReactElement | null
>();
expectTypeOf<TypedSkin>().toEqualTypeOf<DefaultSkin>();
