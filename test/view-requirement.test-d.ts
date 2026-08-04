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
expectTypeOf<View.AnnotationsOf<typeof Open>>().toEqualTypeOf<{}>();

// ── Chain while open ────────────────────────────────────────────────────────

const Mid = Open.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
});
expectTypeOf<View.IsFulfilled<typeof Mid>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Mid>>().toEqualTypeOf<Views.WithSize>();
expectTypeOf<View.AnnotationsOf<typeof Mid>>().toEqualTypeOf<{
  readonly spec: { readonly kind: "app/queue" };
}>();

// ── Fulfill last ────────────────────────────────────────────────────────────

const Done = Mid.Prototype()({ size: Views.ViewKind.Card() });
expectTypeOf<View.IsFulfilled<typeof Done>>().toEqualTypeOf<true>();
expectTypeOf(Done.annotations).toEqualTypeOf<{
  readonly size: Views.CardKind;
  readonly spec: { readonly kind: "app/queue" };
}>();

class DenseCard extends Done.Service<DenseCard>()("app/view/dense-card") {}
void View.succeed(DenseCard, (props) => {
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

class PoolPage extends Views.Page.Service<PoolPage>()("app/view/pool-page", {
  spec: { kind: "app/queue" } as const,
}) {}
expectTypeOf(View.getAnnotations(PoolPage).size).toEqualTypeOf<Views.PageKind>();
expectTypeOf(View.getAnnotations(PoolPage).spec).toEqualTypeOf<{
  readonly kind: "app/queue";
}>();
expectTypeOf<View.AnnotationsOf<typeof PoolPage>>().toEqualTypeOf<
  (typeof PoolPage)[typeof View.annotationsSym]
>();
const _bound = Views.bind("app/queue", PoolPage);
void _bound;

// One-shot Tag with extra props (no Prototype step)
class OneShot extends Views.Card.Service<
  OneShot,
  { readonly dense?: boolean }
>()("app/view/one-shot", { spec: { kind: "app/queue" } as const }) {}
expectTypeOf<View.PropsOf<OneShot>["dense"]>().toEqualTypeOf<
  boolean | undefined
>();
expectTypeOf<View.PropsOf<OneShot>["tag"]>().toEqualTypeOf<Views.ViewTag>();
void View.succeed(OneShot, (props) => {
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

// ── Add Requirement mid-chain (any step) ────────────────────────────────────

type WithSpec = { readonly spec: { readonly kind: string } };

const Fulfilled = View.Prototype<{ readonly label: string }>()({
  label: "x" as const,
});
expectTypeOf<View.IsFulfilled<typeof Fulfilled>>().toEqualTypeOf<true>();

// reopen debt on a fulfilled ancestor
const Reopened = Fulfilled.Prototype<{}, Views.WithSize>()();
expectTypeOf<View.IsFulfilled<typeof Reopened>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Reopened>>().toEqualTypeOf<Views.WithSize>();

// additive debt while already open
const BothOpen = Reopened.Prototype<{}, WithSpec>()();
expectTypeOf<View.IsFulfilled<typeof BothOpen>>().toEqualTypeOf<false>();
type BothReq = View.RequirementOf<typeof BothOpen>;
type BothExpected = {
  readonly size: Views.ViewKind;
  readonly spec: { readonly kind: string };
};
expectTypeOf<BothReq>().toEqualTypeOf<BothExpected>();

const BothDone = BothOpen.Prototype()({
  size: Views.ViewKind.Card(),
  spec: { kind: "app/queue" },
});
expectTypeOf<View.IsFulfilled<typeof BothDone>>().toEqualTypeOf<true>();

// shipped Card is fulfilled — can still open new debt
const CardPlusSpec = Views.Card.Prototype<{}, WithSpec>()();
expectTypeOf<View.IsFulfilled<typeof CardPlusSpec>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof CardPlusSpec>>().toEqualTypeOf<WithSpec>();
// ── bind gate ───────────────────────────────────────────────────────────────

class OpenCard extends Open.Service<OpenCard>()("app/view/open-card") {}
// @ts-expect-error fulfill WithSize before bind
Views.bind("app/queue", OpenCard);

class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {}
// @ts-expect-error no size
Views.bind("app/queue", Greeter);
