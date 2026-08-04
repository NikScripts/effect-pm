/**
 * Last.provided / merge / toLayer — Context.Service value bags.
 */
import { expectTypeOf } from "vitest";
import { Context, Layer } from "effect";
import * as Last from "last-ts/Last";

class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string; readonly crumb?: string }
>()("test/last-provide/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("test/last-provide/ModalMeta") {}

// ── Complete provide → Layer ─────────────────────────────────────────────────

const full = Last.provided(ShellMeta, { title: "Hello" });
const shellLayer = Last.toLayer(full);
expectTypeOf(shellLayer).toEqualTypeOf<Layer.Layer<ShellMeta>>();

const fullDirect = Last.toLayer(ShellMeta, { title: "Hello" });
expectTypeOf(fullDirect).toEqualTypeOf<Layer.Layer<ShellMeta>>();

// ── Incomplete → not a Layer ─────────────────────────────────────────────────

const empty = Last.provided(ShellMeta, {});
const incomplete = Last.toLayer(empty);
expectTypeOf(incomplete).toMatchTypeOf<{
  readonly _error: "Last.toLayer: incomplete provide";
  readonly missing: "title";
}>();

// @ts-expect-error incomplete provide is not Layer<ShellMeta>
const _needLayer: Layer.Layer<ShellMeta> = Last.toLayer(
  Last.provided(ShellMeta, {}),
);

// ── Partial merge, last wins ─────────────────────────────────────────────────

const step1 = Last.provided(ShellMeta, { title: "A" });
const step2 = Last.merge(step1, { title: "B", crumb: "home" });
expectTypeOf(step2.bag.title).toEqualTypeOf<"B">();
expectTypeOf(step2.bag.crumb).toEqualTypeOf<"home">();
expectTypeOf(Last.toLayer(step2)).toEqualTypeOf<Layer.Layer<ShellMeta>>();

// ── Two services — titles do not collide ─────────────────────────────────────

const shell = Last.provided(ShellMeta, { title: "Shell" });
const modal = Last.provided(ModalMeta, { title: "Modal" });
expectTypeOf(Last.toLayer(shell)).toEqualTypeOf<Layer.Layer<ShellMeta>>();
expectTypeOf(Last.toLayer(modal)).toEqualTypeOf<Layer.Layer<ModalMeta>>();
