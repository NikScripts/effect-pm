/**
 * WithSize is a real restriction: SizedPrototype + bind require size.
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

// Stamping size on Prototype → SizedPrototype (constraint applied)
const CardProto = View.Prototype<View.ViewProps>()({ size: "card" as const });
expectTypeOf(CardProto).toEqualTypeOf<
  View.SizedPrototype<View.ViewProps, { readonly size: "card" }>
>();

// No size → open Prototype (not SizedPrototype)
const Naked = View.Prototype<{ readonly name: string }>()();
expectTypeOf(Naked).toEqualTypeOf<View.Prototype<{ readonly name: string }, {}>>();

// Shipped add-ons
expectTypeOf(View.Card).toEqualTypeOf<
  View.SizedPrototype<View.ViewProps, { readonly size: "card" }>
>();
expectTypeOf(View.Detail).toEqualTypeOf<
  View.SizedPrototype<View.ViewProps, { readonly size: "detail" }>
>();
expectTypeOf(View.Page).toEqualTypeOf<
  View.SizedPrototype<View.ViewProps, { readonly size: "page" }>
>();

// Extending keeps SizedPrototype + flat statics
const PageProto = View.Page.Prototype()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf(PageProto).toEqualTypeOf<
  View.SizedPrototype<
    View.ViewProps,
    {
      readonly size: "page";
      readonly spec: { readonly kind: "app/queue" };
    }
  >
>();

class PoolPage extends PageProto.Tag<PoolPage>()("app/view/pool-page") {}
expectTypeOf(PoolPage.size).toEqualTypeOf<"page">();

// bind accepts sized Tag
const _ok = View.bind("app/queue", PoolPage);
void _ok;

// bind rejects Tag with no size
const GreeterProto = View.Prototype<{ readonly name: string }>()();
class Greeter extends GreeterProto.Tag<Greeter>()("app/view/greeter") {}
// @ts-expect-error Greeter has no size — WithSize required
View.bind("app/queue", Greeter);
