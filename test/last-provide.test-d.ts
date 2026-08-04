/**
 * yield* Last.provide → View Provides → Last.toLayer(Service, view)
 */
import { expectTypeOf } from "vitest";
import { Context, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string; readonly crumb?: string }
>()("test/last-provide/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("test/last-provide/ModalMeta") {}

const Hello = View.gen(function* () {
  yield* Last.provide(ShellMeta, { title: "uDumb" });
  return (_props: {}) => null;
});

expectTypeOf<View.ProvidesOf<typeof Hello>>().toMatchTypeOf<
  Last.ProvideToken<
    ShellMeta,
    { readonly title: string; readonly crumb?: string },
    { readonly title: "uDumb" }
  >
>();

const shellLayer = Last.toLayer(ShellMeta, Hello);
expectTypeOf(shellLayer).toEqualTypeOf<Layer.Layer<ShellMeta>>();

const Empty = View.gen(function* () {
  yield* Last.provide(ShellMeta, {});
  return (_props: {}) => null;
});

// @ts-expect-error incomplete provide is not Layer<ShellMeta>
const _needLayer: Layer.Layer<ShellMeta> = Last.toLayer(ShellMeta, Empty);

const Both = View.gen(function* () {
  yield* Last.provide(ShellMeta, { title: "Shell" });
  yield* Last.provide(ModalMeta, { title: "Modal" });
  return (_props: {}) => null;
});

expectTypeOf(Last.toLayer(ShellMeta, Both)).toEqualTypeOf<
  Layer.Layer<ShellMeta>
>();
expectTypeOf(Last.toLayer(ModalMeta, Both)).toEqualTypeOf<
  Layer.Layer<ModalMeta>
>();
