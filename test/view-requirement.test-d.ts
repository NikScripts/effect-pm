/**
 * Prototype Requirement — open, chain, fulfill, helpers, bind gate.
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as Views from "../src/ui/Views";
// ── Open ────────────────────────────────────────────────────────────────────

const Open = View.Prototype<Views.ViewProps, Views.WithSize>()();
expectTypeOf(Open).toEqualTypeOf<View.OpenPrototype<Views.ViewProps, Views.WithSize>>();
expectTypeOf(Views.SizeChrome).toEqualTypeOf<
  View.OpenPrototype<Views.ViewProps, Views.WithSize>
>();
expectTypeOf<View.RequirementOf<typeof Open>>().toEqualTypeOf<Views.WithSize>();
expectTypeOf<View.IsFulfilled<typeof Open>>().toEqualTypeOf<false>();
expectTypeOf<View.StaticsOf<typeof Open>>().toEqualTypeOf<{}>();

// ── Chain while open ────────────────────────────────────────────────────────

const Mid = Open.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf<View.IsFulfilled<typeof Mid>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Mid>>().toEqualTypeOf<Views.WithSize>();
expectTypeOf<View.StaticsOf<typeof Mid>>().toEqualTypeOf<{
  readonly spec: { readonly kind: "app/queue" };
}>();

// ── Fulfill last ────────────────────────────────────────────────────────────

const Done = Mid.Prototype()({ size: Views.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Done>>().toEqualTypeOf<true>();
expectTypeOf(Done.statics).toEqualTypeOf<{
  readonly size: Views.CardKind;
  readonly spec: { readonly kind: "app/queue" };
}>();

class DenseCard extends Done.Tag<DenseCard>()("app/view/dense-card") {}
void DenseCard.provide((props) => {
  expectTypeOf(props.dense).toEqualTypeOf<boolean | undefined>();
  return null;
});
// ── Shipped fulfillments ────────────────────────────────────────────────────

expectTypeOf(Views.Card).toEqualTypeOf<
  View.FulfilledPrototype<Views.ViewProps, Views.WithSize<Views.CardKind>>
>();
expectTypeOf(Views.Detail).toEqualTypeOf<
  View.FulfilledPrototype<Views.ViewProps, Views.WithSize<Views.DetailKind>>
>();
expectTypeOf(Views.Page).toEqualTypeOf<
  View.FulfilledPrototype<Views.ViewProps, Views.WithSize<Views.PageKind>>
>();

class PoolPage extends Views.Page.Tag<PoolPage>()("app/view/pool-page", {
  spec: { kind: "app/queue" } as const,
}) {}
expectTypeOf(PoolPage.size).toEqualTypeOf<Views.PageKind>();
expectTypeOf(PoolPage.spec).toEqualTypeOf<{ readonly kind: "app/queue" }>();
const _bound = Views.bind("app/queue", PoolPage);
void _bound;

// One-shot Tag with extra props (no Prototype step)
class OneShot extends Views.Card.Tag<
  OneShot,
  { readonly dense?: boolean }
>()("app/view/one-shot", { spec: { kind: "app/queue" } as const }) {}
expectTypeOf<View.PropsOf<OneShot>["dense"]>().toEqualTypeOf<
  boolean | undefined
>();
expectTypeOf<View.PropsOf<OneShot>["tag"]>().toEqualTypeOf<Views.ViewTag>();
void View.provide(OneShot, (props) => {
  expectTypeOf(props.dense).toEqualTypeOf<boolean | undefined>();
  return null;
});

// ── Narrowed Requirement stays open if wrong size ───────────────────────────

const WantCard = View.Prototype<Views.ViewProps, Views.WithSize<Views.CardKind>>()();
const Wrong = WantCard.Prototype()({ size: Views.ViewKind.Page() });
// size present but does not satisfy WithSize<CardKind> → still open
expectTypeOf<View.IsFulfilled<typeof Wrong>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Wrong>>().toEqualTypeOf<
  Views.WithSize<Views.CardKind>
>();

const Right = WantCard.Prototype()({ size: Views.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Right>>().toEqualTypeOf<true>();

// ── bind gate ───────────────────────────────────────────────────────────────

class OpenCard extends Open.Tag<OpenCard>()("app/view/open-card") {}
// @ts-expect-error fulfill WithSize before bind
Views.bind("app/queue", OpenCard);

class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {}
// @ts-expect-error no size
Views.bind("app/queue", Greeter);
