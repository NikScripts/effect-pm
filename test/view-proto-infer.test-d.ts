import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

const Handle = View.card.Tag<{ readonly _brand: "x" }>()("hyperlink/view/tmp");
expectTypeOf(Handle.size).toEqualTypeOf<"card">();

class PoolCard extends View.card.Tag<PoolCard>()("hyperlink/view/pool-card") {}
expectTypeOf(PoolCard.size).toEqualTypeOf<"card">();
expectTypeOf<View.Type<typeof PoolCard>>().toEqualTypeOf<View.ViewProps>();
