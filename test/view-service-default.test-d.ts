/**
 * View.make(key, default) — Reference does not appear in Effect R.
 */
import { expectTypeOf } from "vitest";
import { Context, Effect, Layer } from "effect";
import * as React from "react";
import * as View from "last-ts/View";

class Sidebar extends View.make<Sidebar>()(
  "test/view-default-d/Sidebar",
  () => React.createElement("nav", null, "Menu"),
) {}

class Required extends View.make<Required>()(
  "test/view-default-d/Required",
) {}

// Default slot: yield* does not add Sidebar to R
const withDefault = Effect.gen(function* () {
  const Side = yield* Sidebar;
  return Side;
});
expectTypeOf(withDefault).toEqualTypeOf<
  Effect.Effect<View.ViewFn, never, never>
>();

// Required slot: still needs provide
const withRequired = Effect.gen(function* () {
  const R = yield* Required;
  return R;
});
expectTypeOf(withRequired).toEqualTypeOf<
  Effect.Effect<View.ViewFn, never, Required>
>();

// Annotations second-arg overload still works (object, not function)
class Annotated extends View.make<Annotated>()(
  "test/view-default-d/Annotated",
  { spec: { kind: "slot" } as const },
) {}
expectTypeOf(View.getAnnotations(Annotated).spec).toEqualTypeOf<{
  readonly kind: "slot";
}>();
// Required mint (annotations object) is not a Reference — R still open
const needsAnnotated = Effect.gen(function* () {
  return yield* Annotated;
});
expectTypeOf(needsAnnotated).toEqualTypeOf<
  Effect.Effect<View.ViewFn, never, Annotated>
>();

// default + annotations
class Both extends View.make<Both, { readonly label: string }>()(
  "test/view-default-d/Both",
  ({ label }) => React.createElement("span", null, label),
  { spec: { kind: "both" } as const },
) {}
expectTypeOf(View.getAnnotations(Both).spec).toEqualTypeOf<{
  readonly kind: "both";
}>();
void Layer.succeed(Both, ({ label }) => React.createElement("em", null, label));
