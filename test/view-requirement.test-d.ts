/**
 * Prototype Requirement — open, chain, fulfill, helpers, bind gate.
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

// ── Open ────────────────────────────────────────────────────────────────────

const Open = View.Prototype<View.ViewProps, View.WithSize>()();
expectTypeOf(Open).toEqualTypeOf<View.OpenPrototype<View.ViewProps, View.WithSize>>();
expectTypeOf(View.SizeChrome).toEqualTypeOf<
  View.OpenPrototype<View.ViewProps, View.WithSize>
>();
expectTypeOf<View.RequirementOf<typeof Open>>().toEqualTypeOf<View.WithSize>();
expectTypeOf<View.IsFulfilled<typeof Open>>().toEqualTypeOf<false>();
expectTypeOf<View.StaticsOf<typeof Open>>().toEqualTypeOf<{}>();

// ── Chain while open ────────────────────────────────────────────────────────

const Mid = Open.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf<View.IsFulfilled<typeof Mid>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Mid>>().toEqualTypeOf<View.WithSize>();
expectTypeOf<View.StaticsOf<typeof Mid>>().toEqualTypeOf<{
  readonly spec: { readonly kind: "app/queue" };
}>();

// ── Fulfill last ────────────────────────────────────────────────────────────

const Done = Mid.Prototype()({ size: View.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Done>>().toEqualTypeOf<true>();
expectTypeOf(Done.statics).toEqualTypeOf<{
  readonly size: View.CardKind;
  readonly spec: { readonly kind: "app/queue" };
}>();

class DenseCard extends Done.Tag<DenseCard>()("app/view/dense-card") {}
const denseSkin: DenseCard["Service"] = (props) => {
  expectTypeOf(props.dense).toEqualTypeOf<boolean | undefined>();
  return null;
};
void denseSkin;
// ── Shipped fulfillments ────────────────────────────────────────────────────

expectTypeOf(View.Card).toEqualTypeOf<
  View.FulfilledPrototype<View.ViewProps, View.WithSize<View.CardKind>>
>();
expectTypeOf(View.Detail).toEqualTypeOf<
  View.FulfilledPrototype<View.ViewProps, View.WithSize<View.DetailKind>>
>();
expectTypeOf(View.Page).toEqualTypeOf<
  View.FulfilledPrototype<View.ViewProps, View.WithSize<View.PageKind>>
>();

const PageProto = View.Page.Prototype()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf(PageProto.statics.size).toEqualTypeOf<View.PageKind>();

class PoolPage extends PageProto.Tag<PoolPage>()("app/view/pool-page") {}
expectTypeOf(PoolPage.size).toEqualTypeOf<View.PageKind>();
const _bound = View.bind("app/queue", PoolPage);
void _bound;

// ── Narrowed Requirement stays open if wrong size ───────────────────────────

const WantCard = View.Prototype<View.ViewProps, View.WithSize<View.CardKind>>()();
const Wrong = WantCard.Prototype()({ size: View.ViewKind.Page() });
// size present but does not satisfy WithSize<CardKind> → still open
expectTypeOf<View.IsFulfilled<typeof Wrong>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Wrong>>().toEqualTypeOf<
  View.WithSize<View.CardKind>
>();

const Right = WantCard.Prototype()({ size: View.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Right>>().toEqualTypeOf<true>();

// ── bind gate ───────────────────────────────────────────────────────────────

class OpenCard extends Open.Tag<OpenCard>()("app/view/open-card") {}
// @ts-expect-error fulfill WithSize before bind
View.bind("app/queue", OpenCard);

const GreeterProto = View.Prototype<{ readonly name: string }>()();
class Greeter extends GreeterProto.Tag<Greeter>()("app/view/greeter") {}
// @ts-expect-error no size
View.bind("app/queue", Greeter);
