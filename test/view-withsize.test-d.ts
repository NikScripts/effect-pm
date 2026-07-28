/**
 * WithSize / SizedPrototype — size as a type requirement; Simplify flattens merges.
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

// Shared base: size must be the ViewKind union (not yet narrowed).
type Shared = View.SizedPrototype<View.ViewProps, View.WithSize>;
expectTypeOf<View.WithSize["size"]>().toEqualTypeOf<View.ViewKind>();
expectTypeOf<Shared["statics"]["size"]>().toEqualTypeOf<View.ViewKind>();

// Narrowings
expectTypeOf<View.WithSize<"card">["size"]>().toEqualTypeOf<"card">();
expectTypeOf<View.WithSize<"detail">["size"]>().toEqualTypeOf<"detail">();
expectTypeOf<View.WithSize<"page">["size"]>().toEqualTypeOf<"page">();

// Shipped add-ons are SizedPrototype narrowings
expectTypeOf(View.Card).toEqualTypeOf<View.SizedPrototype<View.ViewProps, View.WithSize<"card">>>();
expectTypeOf(View.Detail).toEqualTypeOf<
  View.SizedPrototype<View.ViewProps, View.WithSize<"detail">>
>();
expectTypeOf(View.Page).toEqualTypeOf<View.SizedPrototype<View.ViewProps, View.WithSize<"page">>>();

expectTypeOf(View.Card.statics.size).toEqualTypeOf<"card">();
expectTypeOf(View.Detail.statics.size).toEqualTypeOf<"detail">();
expectTypeOf(View.Page.statics.size).toEqualTypeOf<"page">();

// Extending a sized proto merges statics flat (Simplify) — not `{ size } & { spec }`
const PageProto = View.Page.Prototype()({
  spec: { kind: "app/queue" } as const,
});

type PageStatics = (typeof PageProto)["statics"];
type Expected = {
  readonly size: "page";
  readonly spec: { readonly kind: "app/queue" };
};

expectTypeOf<PageStatics>().toEqualTypeOf<Expected>();

// Tag keeps narrowed size
class PoolPage extends PageProto.Tag<PoolPage>()("app/view/pool-page") {}
expectTypeOf(PoolPage.size).toEqualTypeOf<"page">();

// Assignability: narrowed WithSize satisfies shared WithSize
const _cardOk: View.WithSize = View.Card.statics;
const _pageOk: View.WithSize = { size: "page" };
void _cardOk;
void _pageOk;
