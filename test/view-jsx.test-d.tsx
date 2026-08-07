/**
 * View compose — Service + Layer; mount(Service) at the edge.
 */
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
  static layer = Layer.effect(
    Child,
    Effect.gen(function* () {
      const name = yield* Greeter;
      return (_props: {}) => <span data-child>{name}</span>;
    }),
  ).pipe(Layer.provide(Layer.succeed(Greeter, "nik")));
}

const Plain = (props: { readonly label: string }): React.ReactElement => (
  <button type="button">{props.label}</button>
);

const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

expectTypeOf(Child.layer).toMatchTypeOf<Layer.Layer<Child>>();
// @ts-expect-error Service class is not a JSX component — mount or yield*
const _badChildJsx = <Child />;

class Both extends View.Service<Both>()("test/jsx/Both") {
  static layer = Layer.effect(
    Both,
    Effect.gen(function* () {
      const services = yield* Effect.all({ Greeter, Clock });
      return (_props: {}) => (
        <div>
          <span data-child>{services.Greeter}</span>
          <span data-other>{services.Clock}</span>
        </div>
      );
    }),
  ).pipe(
    Layer.provide(Layer.succeed(Greeter, "a")),
    Layer.provide(Layer.succeed(Clock, 1)),
  );
}
expectTypeOf(Both.layer).toMatchTypeOf<Layer.Layer<Both>>();
type _BothNotAny = Expect<NotAny<typeof Both.layer>>;

const App = View.mount(Child);
expectTypeOf(App).toMatchTypeOf<View.Component>();
const _okAppJsx = <App />;

class Wrap extends View.Service<Wrap>()("test/jsx/Wrap") {
  static layer = Layer.effect(
    Wrap,
    Effect.gen(function* () {
      const C = yield* Child;
      return (_props: {}) => (
        <section>
          <C />
        </section>
      );
    }),
  ).pipe(Layer.provide(Child.layer));
}
const Wrapped = View.mount(Wrap);
expectTypeOf(Wrapped).toMatchTypeOf<View.Component>();

const _okDialog = <Dialog open onOpenChange={(_open: boolean) => undefined} />;
// @ts-expect-error Radix Root does not take a fake prop
const _badDialog = <Dialog open notARealProp />;

const _okPlain = <Plain label="x" />;
// @ts-expect-error Plain requires label
const _badPlain = <Plain />;

class Pure extends View.Service<Pure>()("test/jsx/Pure") {
  static layer = Layer.succeed(Pure, (_props: {}) => <span>ok</span>);
}
const PureApp = View.mount(Pure);
const _okPure = <PureApp />;

void Effect.void;
