/**
 * View compose — Service Layers, yield*, mount at the edge.
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

class Child extends View.Service<Child>()("test/jsx/Child") {
  static layer = View.gen(Child, function* () {
    const name = yield* Greeter;
    return (_props: {}) => <span data-child>{name}</span>;
  });
}

const Plain = (props: { readonly label: string }): React.ReactElement => (
  <button type="button">{props.label}</button>
);

const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

// ── Layer carries R; Service itself is not a freestanding View value ─────────

expectTypeOf(Child.layer).toMatchTypeOf<Layer.Layer<Child, never, Greeter>>();
// @ts-expect-error Service class is not a JSX component — mount or yield*
const _badChildJsx = <Child />;

// ── Effect.all merges services inside View.gen ───────────────────────────────

class Both extends View.Service<Both>()("test/jsx/Both") {
  static layer = View.gen(Both, function* () {
    const services = yield* Effect.all({ Greeter, Clock });
    return (_props: {}) => (
      <div>
        <span data-child>{services.Greeter}</span>
        <span data-other>{services.Clock}</span>
      </div>
    );
  });
}
expectTypeOf(Both.layer).toMatchTypeOf<
  Layer.Layer<Both, never, Greeter | Clock>
>();
type _BothNotAny = Expect<NotAny<Layer.Services<typeof Both.layer>>>;

// ── mount(Service, layer) is the JSX edge ────────────────────────────────────

const App = View.mount(
  Child,
  Child.layer.pipe(Layer.provide(Layer.succeed(Greeter, "nik"))),
);
expectTypeOf(App).toMatchTypeOf<View.Component>();
const _okAppJsx = <App />;

// Nested: yield* Child after mounting is wrong — compose via Layers instead
class Wrap extends View.Service<Wrap>()("test/jsx/Wrap") {
  static layer = View.gen(Wrap, function* () {
    const C = yield* Child;
    return (_props: {}) => (
      <section>
        <C />
      </section>
    );
  });
}
const Wrapped = View.mount(
  Wrap,
  Wrap.layer.pipe(
    Layer.provide(Child.layer),
    Layer.provide(Layer.succeed(Greeter, "nik")),
  ),
);
expectTypeOf(Wrapped).toMatchTypeOf<View.Component>();

// ── Outside components keep normal prop checking ─────────────────────────────

const _okDialog = <Dialog open onOpenChange={(_open: boolean) => undefined} />;
// @ts-expect-error Radix Root does not take a fake prop
const _badDialog = <Dialog open notARealProp />;

const _okPlain = <Plain label="x" />;
// @ts-expect-error Plain requires label
const _badPlain = <Plain />;

// ── View.succeed builds a Layer, not a JSX component ─────────────────────────

class Pure extends View.Service<Pure>()("test/jsx/Pure") {
  static layer = View.succeed(Pure, (_props: {}) => <span>ok</span>);
}
expectTypeOf(Pure.layer).toMatchTypeOf<View.ViewLayer<Pure>>();
const PureApp = View.mount(Pure, Pure.layer);
const _okPure = <PureApp />;

void Effect.void;
