/**
 * View.Service — Context.Service-shaped mint; default Layer via `static layer`.
 */
import { expectTypeOf } from "vitest";
import { Layer } from "effect";
import * as View from "last-ts/View";

class Callout extends View.Service<Callout, { readonly text: string }>()(
  "test/view-service/Callout",
) {
  static layer = Callout.provide(({ text }) => {
    void text;
    return null;
  });
}

expectTypeOf(Callout.layer).toEqualTypeOf<Layer.Layer<Callout>>();

class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "test/view-service/Greeter",
) {}

const greeterLayer = Greeter.provide(({ name }) => {
  void name;
  return null;
});
expectTypeOf(greeterLayer).toEqualTypeOf<Layer.Layer<Greeter>>();

// @ts-expect-error no static layer → no .layer on the handle
const _noLayer: Layer.Layer<Greeter> = Greeter.layer;
