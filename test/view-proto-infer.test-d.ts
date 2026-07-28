import type * as React from "react";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

const Handle = View.Card.Tag<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(Handle.size).toEqualTypeOf<View.CardKind>();

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(PoolCard.size).toEqualTypeOf<View.CardKind>();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<View.ViewProps>();

// Svc type is View.View (defaults to ViewProps)
type ChromeSkin = View.View;
type TypedSkin = View.View<View.Type<typeof PoolCard>>;
expectTypeOf<ChromeSkin>().toEqualTypeOf<
  (props: View.ViewProps) => React.ReactElement | null
>();
expectTypeOf<TypedSkin>().toEqualTypeOf<ChromeSkin>();
