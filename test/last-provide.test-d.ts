/**
 * Last.provide — entry-point Effect.provide + run type surface.
 */
import { expectTypeOf } from "vitest";
import { Context, Effect, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Greeter extends Context.Service<Greeter, string>()(
  "hyperlink-ts/test/last-provide.test-d/Greeter",
) {
  static layer = Layer.succeed(Greeter, "hello");
}

const greeting = Last.provide(Greeter, Greeter.layer);
expectTypeOf(greeting).toEqualTypeOf<string>();

const one = Last.provide(Effect.succeed(1));
expectTypeOf(one).toEqualTypeOf<number>();

class Open extends Context.Service<Open, string>()(
  "hyperlink-ts/test/last-provide.test-d/Open",
) {
  static layer = Layer.effect(Open, Greeter);
}

expectTypeOf(
  Last.provide(Open, Layer.provide(Open.layer, Greeter.layer)),
).toEqualTypeOf<string>();

expectTypeOf(Open.layer).toMatchTypeOf<Layer.Layer<Open, never, Greeter>>();

class Hello extends View.make<Hello, { readonly who: string }>()(
  "test/last-provide.test-d/Hello",
) {
  static layer = Layer.succeed(Hello, ({ who }) => {
    void who;
    return null;
  });
}

const Root = Last.provide(Hello, Hello.layer);
expectTypeOf(Root).toMatchTypeOf<View.ViewFn<{ readonly who: string }>>();
