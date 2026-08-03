/**
 * Typed JSX — child → parent → component `R` (last-ts/jsx-runtime).
 *
 * Uses real Radix (+ a shadcn-style thin wrapper) so outside components stay valid.
 */
/** @jsxImportSource last-ts */
import { expectTypeOf } from "vitest";
import { Context, Effect } from "effect";
import type * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as Jsx from "last-ts/Jsx";
import * as View from "last-ts/View";

type Eq<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ── Fixtures ────────────────────────────────────────────────────────────────

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

/** Plain React component (no Element brand) — like typical library output. */
const Plain = (props: { readonly label: string }): React.ReactElement => (
  <button type="button">{props.label}</button>
);

/**
 * shadcn-style thin wrapper over Radix (mirrors `src/web/components/ui/dialog`).
 * Returns a normal React element — must not break under last-ts jsx.
 */
const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

const DialogTrigger = (
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
): React.ReactElement => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

const DialogContent = (
  props: React.ComponentProps<typeof DialogPrimitive.Content>,
): React.ReactElement => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay />
    <DialogPrimitive.Content data-slot="dialog-content" {...props} />
  </DialogPrimitive.Portal>
);

// ── Nested JSX bubbles R ────────────────────────────────────────────────────

const nested = (
  <div>
    <Child />
    <Other />
  </div>
);
type _Nested = Expect<
  Eq<Jsx.ServicesOf<typeof nested>, Greeter | Clock>
>;

const throughRadix = (
  <Dialog open>
    <DialogTrigger>open</DialogTrigger>
    <DialogContent>
      <Child />
      <Plain label="ok" />
    </DialogContent>
  </Dialog>
);
type _ThroughRadix = Expect<
  Eq<Jsx.ServicesOf<typeof throughRadix>, Greeter>
>;

const onlyOutside = (
  <Dialog open>
    <DialogTrigger>open</DialogTrigger>
    <DialogContent>
      <Plain label="solo" />
      <span>text</span>
    </DialogContent>
  </Dialog>
);
type _OnlyOutside = Expect<Eq<Jsx.ServicesOf<typeof onlyOutside>, never>>;

// ── View.gen captures yield* R and tree R ────────────────────────────────────

const Parent = View.gen(function* () {
  return (props: { readonly children?: Jsx.Element<Greeter> }) => (
    <section>{props.children}</section>
  );
});
expectTypeOf<View.ServicesOf<typeof Parent>>().toEqualTypeOf<Greeter>();

const NestedInBody = View.gen(function* () {
  return (_props: {}) => (
    <section>
      <Child />
    </section>
  );
});
expectTypeOf<View.ServicesOf<typeof NestedInBody>>().toEqualTypeOf<Greeter>();

const Both = View.gen(function* () {
  const _prefix = yield* Greeter;
  return (_props: {}) => (
    <div>
      <Other />
    </div>
  );
});
expectTypeOf<View.ServicesOf<typeof Both>>().toEqualTypeOf<Greeter | Clock>();

const Empty = View.gen(function* () {
  yield* Greeter;
});
expectTypeOf<View.ServicesOf<typeof Empty>>().toEqualTypeOf<Greeter>();

// ── Component function sees tree R via return ────────────────────────────────

const Component = () => (
  <Parent>
    <Child />
  </Parent>
);
type _Component = Expect<
  Eq<Jsx.ServicesOf<ReturnType<typeof Component>>, Greeter>
>;

// ── Outside components keep normal prop checking ─────────────────────────────

const _okDialog = <Dialog open onOpenChange={(_open: boolean) => undefined} />;
// @ts-expect-error Radix Root does not take a fake prop
const _badDialog = <Dialog open notARealProp />;

const _okPlain = <Plain label="x" />;
// @ts-expect-error Plain requires label
const _badPlain = <Plain />;

// ── succeed / fromEffect preserve TreeR ─────────────────────────────────────

const Succeeded = View.succeed((_props: {}) => (
  <div>
    <Child />
  </div>
));
expectTypeOf<View.ServicesOf<typeof Succeeded>>().toEqualTypeOf<Greeter>();

const FromFx = View.fromEffect(
  Effect.succeed((_props: {}) => (
    <div>
      <Other />
    </div>
  )),
);
expectTypeOf<View.ServicesOf<typeof FromFx>>().toEqualTypeOf<Clock>();
