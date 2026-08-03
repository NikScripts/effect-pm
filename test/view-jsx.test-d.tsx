/**
 * View compose — opaque open R, bag succeed/gen, mount.
 */
/** @jsxImportSource last-ts */
import { expectTypeOf } from "vitest";
import { Context, Effect, Layer } from "effect";
import type * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as View from "last-ts/View";

type NotAny<T> = 0 extends 1 & T ? false : true;
type Expect<T extends true> = T;

class Greeter extends Context.Service<Greeter, string>()("test/jsx/Greeter") {}
class Clock extends Context.Service<Clock, number>()("test/jsx/Clock") {}

const Child = View.gen(function* () {
  const name = yield* Greeter;
  return (_props: {}) => <span data-child>{name}</span>;
});

const Other = View.gen(function* () {
  const t = yield* Clock;
  return (_props: {}) => <span data-other>{t}</span>;
});

const Plain = (props: { readonly label: string }): React.ReactElement => (
  <button type="button">{props.label}</button>
);

const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

// ── Open R is not JSX-legal ──────────────────────────────────────────────────

expectTypeOf(Child).toMatchTypeOf<View.Unresolved<object, Greeter>>();
// @ts-expect-error open-R view is not a JSX component
const _badChildJsx = <Child />;

// ── View.gen yield* R ────────────────────────────────────────────────────────

expectTypeOf<View.ServicesOf<typeof Child>>().toEqualTypeOf<Greeter>();

const Empty = View.gen(function* () {
  yield* Greeter;
});
expectTypeOf<View.ServicesOf<typeof Empty>>().toEqualTypeOf<Greeter>();

// ── Bag succeed / gen merge child R; JSX inside callback ─────────────────────

const Middle = View.succeed({ Child }, ({ Child }) => (_props: {}) => (
  <section>
    <Child />
  </section>
));
expectTypeOf<View.ServicesOf<typeof Middle>>().toEqualTypeOf<Greeter>();
type _MiddleNotAny = Expect<NotAny<View.ServicesOf<typeof Middle>>>;

const Both = View.gen({ Child, Other }, function* ({ Child, Other }) {
  return (_props: {}) => (
    <div>
      <Child />
      <Other />
    </div>
  );
});
expectTypeOf<View.ServicesOf<typeof Both>>().toEqualTypeOf<Greeter | Clock>();

// ── mount discharges R ───────────────────────────────────────────────────────

const App = View.mount(Middle, Layer.succeed(Greeter, "nik"));
expectTypeOf<View.ServicesOf<typeof App>>().toEqualTypeOf<never>();
const _okAppJsx = <App />;

// ── Outside components keep normal prop checking ─────────────────────────────

const _okDialog = <Dialog open onOpenChange={(_open: boolean) => undefined} />;
// @ts-expect-error Radix Root does not take a fake prop
const _badDialog = <Dialog open notARealProp />;

const _okPlain = <Plain label="x" />;
// @ts-expect-error Plain requires label
const _badPlain = <Plain />;

// ── succeed unary (no open R) stays JSX-legal ────────────────────────────────

const Pure = View.succeed((_props: {}) => <span>ok</span>);
expectTypeOf<View.ServicesOf<typeof Pure>>().toEqualTypeOf<never>();
const _okPure = <Pure />;

void Effect.void;
