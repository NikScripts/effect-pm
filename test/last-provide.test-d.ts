/**
 * yield* Last.provide → ViewLayer Provides → Last.toLayer(Service, layer)
 */
import { expectTypeOf } from "vitest";
import { Context, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string; readonly crumb?: string }
>()("hyperlink-ts/test/last-provide.test-d/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("hyperlink-ts/test/last-provide.test-d/ModalMeta") {}

class Hello extends View.Service<Hello>()("test/last-provide-d/Hello") {
  static layer = View.gen(Hello, function* () {
    yield* Last.provide(ShellMeta, { title: "uDumb" });
    return (_props: {}) => null;
  });
}

expectTypeOf(Hello.layer).toMatchTypeOf<
  View.ViewLayer<
    Hello,
    never,
    never,
    Last.ProvideToken<
      ShellMeta,
      { readonly title: string; readonly crumb?: string },
      { readonly title: "uDumb" }
    >
  >
>();

const shellLayer = Last.toLayer(ShellMeta, Hello.layer);
expectTypeOf(shellLayer).toEqualTypeOf<Layer.Layer<ShellMeta>>();

class Empty extends View.Service<Empty>()("test/last-provide-d/Empty") {
  static layer = View.gen(Empty, function* () {
    yield* Last.provide(ShellMeta, {});
    return (_props: {}) => null;
  });
}

// @ts-expect-error incomplete provide is not Layer<ShellMeta>
const _incomplete: Layer.Layer<ShellMeta> = Last.toLayer(
  ShellMeta,
  Empty.layer,
);

class Both extends View.Service<Both>()("test/last-provide-d/Both") {
  static layer = View.gen(Both, function* () {
    yield* Last.provide(ShellMeta, { title: "Shell" });
    yield* Last.provide(ModalMeta, { title: "Modal" });
    return (_props: {}) => null;
  });
}

expectTypeOf(Last.toLayer(ShellMeta, Both.layer)).toEqualTypeOf<
  Layer.Layer<ShellMeta>
>();
expectTypeOf(Last.toLayer(ModalMeta, Both.layer)).toEqualTypeOf<
  Layer.Layer<ModalMeta>
>();
