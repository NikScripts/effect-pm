/**
 * Prototype Requirement — open, chain, fulfill, helpers, bind gate.
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";
import * as Ui from "../src/ui/Ui";

// ── Open ────────────────────────────────────────────────────────────────────

const Open = View.Prototype<Ui.ViewProps, Ui.WithSize>()();
expectTypeOf(Open).toEqualTypeOf<View.OpenPrototype<Ui.ViewProps, Ui.WithSize>>();
expectTypeOf(Ui.SizeChrome).toEqualTypeOf<
  View.OpenPrototype<Ui.ViewProps, Ui.WithSize>
>();
expectTypeOf<View.RequirementOf<typeof Open>>().toEqualTypeOf<Ui.WithSize>();
expectTypeOf<View.IsFulfilled<typeof Open>>().toEqualTypeOf<false>();
expectTypeOf<View.StaticsOf<typeof Open>>().toEqualTypeOf<{}>();

// ── Chain while open ────────────────────────────────────────────────────────

const Mid = Open.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf<View.IsFulfilled<typeof Mid>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Mid>>().toEqualTypeOf<Ui.WithSize>();
expectTypeOf<View.StaticsOf<typeof Mid>>().toEqualTypeOf<{
  readonly spec: { readonly kind: "app/queue" };
}>();

// ── Fulfill last ────────────────────────────────────────────────────────────

const Done = Mid.Prototype()({ size: Ui.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Done>>().toEqualTypeOf<true>();
expectTypeOf(Done.statics).toEqualTypeOf<{
  readonly size: Ui.CardKind;
  readonly spec: { readonly kind: "app/queue" };
}>();

class DenseCard extends Done.Tag<DenseCard>()("app/view/dense-card") {}
void DenseCard.provide((props) => {
  expectTypeOf(props.dense).toEqualTypeOf<boolean | undefined>();
  return null;
});
// ── Shipped fulfillments ────────────────────────────────────────────────────

expectTypeOf(Ui.Card).toEqualTypeOf<
  View.FulfilledPrototype<Ui.ViewProps, Ui.WithSize<Ui.CardKind>>
>();
expectTypeOf(Ui.Detail).toEqualTypeOf<
  View.FulfilledPrototype<Ui.ViewProps, Ui.WithSize<Ui.DetailKind>>
>();
expectTypeOf(Ui.Page).toEqualTypeOf<
  View.FulfilledPrototype<Ui.ViewProps, Ui.WithSize<Ui.PageKind>>
>();

class PoolPage extends Ui.Page.Tag<PoolPage>()("app/view/pool-page", {
  spec: { kind: "app/queue" } as const,
}) {}
expectTypeOf(PoolPage.size).toEqualTypeOf<Ui.PageKind>();
expectTypeOf(PoolPage.spec).toEqualTypeOf<{ readonly kind: "app/queue" }>();
const _bound = Ui.bind("app/queue", PoolPage);
void _bound;

// One-shot Tag with extra props (no Prototype step)
class OneShot extends Ui.Card.Tag<
  OneShot,
  { readonly dense?: boolean }
>()("app/view/one-shot", { spec: { kind: "app/queue" } as const }) {}
expectTypeOf<View.PropsOf<OneShot>["dense"]>().toEqualTypeOf<
  boolean | undefined
>();
expectTypeOf<View.PropsOf<OneShot>["tag"]>().toEqualTypeOf<Ui.ViewTag>();
void View.provide(OneShot, (props) => {
  expectTypeOf(props.dense).toEqualTypeOf<boolean | undefined>();
  return null;
});

// ── Narrowed Requirement stays open if wrong size ───────────────────────────

const WantCard = View.Prototype<Ui.ViewProps, Ui.WithSize<Ui.CardKind>>()();
const Wrong = WantCard.Prototype()({ size: Ui.ViewKind.Page() });
// size present but does not satisfy WithSize<CardKind> → still open
expectTypeOf<View.IsFulfilled<typeof Wrong>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Wrong>>().toEqualTypeOf<
  Ui.WithSize<Ui.CardKind>
>();

const Right = WantCard.Prototype()({ size: Ui.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Right>>().toEqualTypeOf<true>();

// ── bind gate ───────────────────────────────────────────────────────────────

class OpenCard extends Open.Tag<OpenCard>()("app/view/open-card") {}
// @ts-expect-error fulfill WithSize before bind
Ui.bind("app/queue", OpenCard);

class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {}
// @ts-expect-error no size
Ui.bind("app/queue", Greeter);
