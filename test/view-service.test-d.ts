/**
 * View.Service — Context.Service mint; Layer via View.succeed / View.gen.
 */
import { expectTypeOf } from "vitest";
import { Layer } from "effect";
import * as View from "last-ts/View";

class Callout extends View.Service<Callout, { readonly text: string }>()(
  "test/view-service/Callout",
) {
  static layer = View.succeed(Callout, ({ text }) => {
    void text;
    return null;
  });
}

expectTypeOf(Callout.layer).toEqualTypeOf<View.ViewLayer<Callout>>();

class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "test/view-service/Greeter",
) {}

const greeterLayer = View.succeed(Greeter, ({ name }) => {
  void name;
  return null;
});
expectTypeOf(greeterLayer).toEqualTypeOf<View.ViewLayer<Greeter>>();

class Hello extends View.Service<Hello, { readonly who: string }>()(
  "test/view-service/Hello",
) {
  static layer = View.gen(Hello, function* () {
    const G = yield* Greeter;
    return (props: { readonly who: string }) => {
      void G;
      void props;
      return null;
    };
  });
}

expectTypeOf(Hello.layer).toMatchTypeOf<
  Layer.Layer<Hello, never, Greeter>
>();

// @ts-expect-error no static layer → no .layer on the handle
const _noLayer: Layer.Layer<Greeter> = Greeter.layer;
