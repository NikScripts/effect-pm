/**
 * Layer + atoms for the typed-JSX docs island (declared once — not in the island UI file).
 */
import { Atom } from "effect/unstable/reactivity";
import { Layer } from "effect";
import { Clock, Greeter, Page } from "../../../../examples/ui/view-typed-jsx";

/** App edge — fulfill the aggregated R from nested Views. */
export const demoLayer = Layer.mergeAll(
  Layer.succeed(Greeter, "nik"),
  Layer.succeed(Clock, 42),
);

export const demoRuntime = Atom.runtime(demoLayer);

export { Page };
