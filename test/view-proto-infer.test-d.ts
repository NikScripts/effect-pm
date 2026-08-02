import type * as React from "react";
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as Ui from "../src/ui/Ui";

const Handle = Ui.Card.Tag<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(Handle.size).toEqualTypeOf<Ui.CardKind>();

class PoolCard extends Ui.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(PoolCard.size).toEqualTypeOf<Ui.CardKind>();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<Ui.ViewProps>();
expectTypeOf<View.PropsOf<PoolCard>>().toEqualTypeOf<Ui.ViewProps>();
expectTypeOf<PoolCard["Service"]>().toEqualTypeOf<View.View<Ui.ViewProps>>();

// Svc type is View.View (defaults to {})
type ChromeSkin = View.View<Ui.ViewProps>;
type TypedSkin = PoolCard["Service"];
expectTypeOf<ChromeSkin>().toEqualTypeOf<
  (props: Ui.ViewProps) => React.ReactElement | null
>();
expectTypeOf<TypedSkin>().toEqualTypeOf<ChromeSkin>();
