import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

const Handle = View.Card.Tag<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(Handle.size).toEqualTypeOf<"card">();

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(PoolCard.size).toEqualTypeOf<"card">();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<View.ViewProps>();
