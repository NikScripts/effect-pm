/**
 * Chain multiple Prototype steps while Requirement stays open; fulfill last.
 */
import { expectTypeOf } from "vitest";
import * as View from "../src/ui/View";

const Open = View.Prototype<View.ViewProps, View.WithSize>()();

// Statics only — still open
const Mid = Open.Prototype()({ spec: { kind: "app/queue" } as const });
expectTypeOf<View.IsFulfilled<typeof Mid>>().toEqualTypeOf<false>();
expectTypeOf<View.RequirementOf<typeof Mid>>().toEqualTypeOf<View.WithSize>();

// Props only — still open
const PropsMid = Open.Prototype<{ readonly dense?: boolean }>()();
expectTypeOf<View.IsFulfilled<typeof PropsMid>>().toEqualTypeOf<false>();

// Props + statics — still open
const Both = Open.Prototype<{ readonly dense?: boolean }>()({
  label: "x" as const,
});
expectTypeOf<View.IsFulfilled<typeof Both>>().toEqualTypeOf<false>();

// Fulfill last
const Done = Both.Prototype()({ size: "card" as const });
expectTypeOf<View.IsFulfilled<typeof Done>>().toEqualTypeOf<true>();
expectTypeOf(Done.statics).toEqualTypeOf<{
  readonly size: "card";
  readonly label: "x";
}>();
