/**
 * Requirement is R-style debt: declare open, fulfill later via .Prototype().
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

// Open — Requirement declared, not fulfilled
const Open = View.Prototype<View.ViewProps, View.WithSize>()();
expectTypeOf(Open).toEqualTypeOf<
  View.Prototype<View.ViewProps, View.WithSize, {}>
>();
expectTypeOf<View.RequirementOf<typeof Open>>().toEqualTypeOf<View.WithSize>();
expectTypeOf<View.IsFulfilled<typeof Open>>().toEqualTypeOf<false>();

// Fulfill later — statics only
const CardFromOpen = Open.Prototype()({ size: "card" as const });
expectTypeOf(CardFromOpen).toEqualTypeOf<
  View.Prototype<View.ViewProps, {}, { readonly size: "card" }>
>();
expectTypeOf<View.IsFulfilled<typeof CardFromOpen>>().toEqualTypeOf<true>();

// Shipped SizeChrome = open; Card/Detail/Page = fulfilled
expectTypeOf(View.SizeChrome).toEqualTypeOf<
  View.Prototype<View.ViewProps, View.WithSize, {}>
>();
expectTypeOf(View.Card).toEqualTypeOf<
  View.Prototype<View.ViewProps, {}, { readonly size: "card" }>
>();
expectTypeOf(View.Detail).toEqualTypeOf<
  View.Prototype<View.ViewProps, {}, { readonly size: "detail" }>
>();
expectTypeOf(View.Page).toEqualTypeOf<
  View.Prototype<View.ViewProps, {}, { readonly size: "page" }>
>();

// Extending fulfilled proto — still fulfilled, statics additive
const PageProto = View.Page.Prototype()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf(PageProto).toEqualTypeOf<
  View.Prototype<
    View.ViewProps,
    {},
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

// Tag on open proto — mint OK, bind fails (no size)
class OpenCard extends Open.Tag<OpenCard>()("app/view/open-card") {}
// @ts-expect-error open Tag has no size — fulfill before bind
View.bind("app/queue", OpenCard);

const GreeterProto = View.Prototype<{ readonly name: string }>()();
class Greeter extends GreeterProto.Tag<Greeter>()("app/view/greeter") {}
// @ts-expect-error no size
View.bind("app/queue", Greeter);
