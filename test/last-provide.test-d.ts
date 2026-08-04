/**
 * yield* Last.provide → Last.toLayer(Service, gen)
 */
import { expectTypeOf } from "vitest";
import { Context, Layer } from "effect";
import * as Last from "last-ts/Last";

class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string; readonly crumb?: string }
>()("hyperlink-ts/test/last-provide.test-d/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("hyperlink-ts/test/last-provide.test-d/ModalMeta") {}

function* helloProvides() {
  yield* Last.provide(ShellMeta, { title: "uDumb" });
}

const shellLayer = Last.toLayer(ShellMeta, helloProvides);
expectTypeOf(shellLayer).toEqualTypeOf<Layer.Layer<ShellMeta>>();

function* emptyProvides() {
  yield* Last.provide(ShellMeta, {});
}

// @ts-expect-error incomplete provide is not Layer<ShellMeta>
const _incomplete: Layer.Layer<ShellMeta> = Last.toLayer(
  ShellMeta,
  emptyProvides,
);

function* bothProvides() {
  yield* Last.provide(ShellMeta, { title: "Shell" });
  yield* Last.provide(ModalMeta, { title: "Modal" });
}

expectTypeOf(Last.toLayer(ShellMeta, bothProvides)).toEqualTypeOf<
  Layer.Layer<ShellMeta>
>();
expectTypeOf(Last.toLayer(ModalMeta, bothProvides)).toEqualTypeOf<
  Layer.Layer<ModalMeta>
>();
