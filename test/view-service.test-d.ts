/**
 * View.make — Context.Service mint; layers via Layer.succeed / Layer.effect.
 */
import { expectTypeOf } from "vitest";
import { Effect, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Callout extends View.make<Callout, { readonly text: string }>()(
  "test/view-service/Callout",
) {
  static layer = Layer.succeed(Callout, ({ text }) => {
    void text;
    return null;
  });
}

expectTypeOf(Callout.layer).toEqualTypeOf<Layer.Layer<Callout>>();

class Greeter extends View.make<Greeter, { readonly name: string }>()(
  "test/view-service/Greeter",
) {
  static layer = Layer.succeed(Greeter, ({ name }) => {
    void name;
    return null;
  });
}

class Hello extends View.make<Hello, { readonly who: string }>()(
  "test/view-service/Hello",
) {
  static layer = Layer.effect(
    Hello,
    Effect.gen(function* () {
      const G = yield* Greeter;
      return (props: { readonly who: string }) => {
        void G;
        void props;
        return null;
      };
    }),
  ).pipe(Layer.provide(Greeter.layer));
}

expectTypeOf(Hello.layer).toMatchTypeOf<Layer.Layer<Hello>>();

const Root = View.stamp(Last.provide(Hello, Hello.layer));
expectTypeOf(Root).toMatchTypeOf<View.Component<{ readonly who: string }>>();

class Open extends View.make<Open>()("test/view-service/Open") {
  static layer = Layer.effect(
    Open,
    Effect.gen(function* () {
      yield* Hello;
      return () => null;
    }),
  );
}
// Open.layer still requires Hello — not fulfillable without requirements.
expectTypeOf(Open.layer).not.toEqualTypeOf<Layer.Layer<Open>>();
