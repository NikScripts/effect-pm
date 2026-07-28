/**
 * Constraint is a type param: Prototype<Props, Constraint>()(statics).
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

// TYPE PARAM = the constraint
const CardProto = View.Prototype<View.ViewProps, View.WithSize<"card">>()({
  size: "card" as const,
});
expectTypeOf(CardProto).toEqualTypeOf<
  View.Prototype<View.ViewProps, View.WithSize<"card">, { readonly size: "card" }>
>();

// No constraint type param (defaults {})
const Naked = View.Prototype<{ readonly name: string }>()();
expectTypeOf(Naked).toEqualTypeOf<
  View.Prototype<{ readonly name: string }, {}, {}>
>();

// Missing size while Constraint = WithSize → error
// @ts-expect-error statics must extend WithSize<"card">
View.Prototype<View.ViewProps, View.WithSize<"card">>()({});

// Shipped add-ons use the Constraint type param
expectTypeOf(View.Card).toEqualTypeOf<
  View.Prototype<View.ViewProps, View.WithSize<"card">, { readonly size: "card" }>
>();
expectTypeOf(View.Detail).toEqualTypeOf<
  View.Prototype<
    View.ViewProps,
    View.WithSize<"detail">,
    { readonly size: "detail" }
  >
>();
expectTypeOf(View.Page).toEqualTypeOf<
  View.Prototype<View.ViewProps, View.WithSize<"page">, { readonly size: "page" }>
>();

// Extend keeps Constraint type param
const PageProto = View.Page.Prototype()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf(PageProto).toEqualTypeOf<
  View.Prototype<
    View.ViewProps,
    View.WithSize<"page">,
    {
      readonly size: "page";
      readonly spec: { readonly kind: "app/queue" };
    }
  >
>();

class PoolPage extends PageProto.Tag<PoolPage>()("app/view/pool-page") {}
expectTypeOf(PoolPage.size).toEqualTypeOf<"page">();

const _ok = View.bind("app/queue", PoolPage);
void _ok;

const GreeterProto = View.Prototype<{ readonly name: string }>()();
class Greeter extends GreeterProto.Tag<Greeter>()("app/view/greeter") {}
// @ts-expect-error Greeter has no size — bind requires WithSize
View.bind("app/queue", Greeter);
