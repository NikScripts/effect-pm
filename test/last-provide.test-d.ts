/**
 * Last.provide — entry-point fulfill type surface.
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

expectTypeOf(Last.provide(Greeter)).toEqualTypeOf<string>();
expectTypeOf(Last.provide(Effect.succeed(1))).toEqualTypeOf<number>();

class Open extends Context.Service<Open, string>()(
  "hyperlink-ts/test/last-provide.test-d/Open",
) {
  static layer = Layer.effect(
    Open,
    Effect.gen(function* () {
      return yield* Greeter;
    }),
  );
}

expectTypeOf(Last.provide(Open, Greeter.layer)).toEqualTypeOf<string>();

// @ts-expect-error open-R Service needs requirements
Last.provide(Open);

class Hello extends View.make<Hello, { readonly who: string }>()(
  "test/last-provide.test-d/Hello",
) {
  static layer = Layer.succeed(Hello, ({ who }) => {
    void who;
    return null;
  });
}

const Root = View.stamp(Last.provide(Hello));
expectTypeOf(Root).toMatchTypeOf<View.Component<{ readonly who: string }>>();
