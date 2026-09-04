/**
 * @module examples/ui/view-typed-jsx/lib/Hello
 *
 * Why View exists: `yield*` a leaf View inside `Layer.effect`, then fulfill at the
 * edge with a **const** Layer — never `static layer` on the class.
 */
import { Effect, Layer } from "effect";
import * as View from "last-ts/View";
import * as Greeter from "../ui/Greeter";

export class Hello extends View.make<Hello, { readonly who: string }>()(
  "examples/ui/view-typed-jsx/Hello",
) {}

/** Installs `Hello` by yielding `Greeter` (Reference default — no Greeter Layer). */
export const helloLayer = Layer.effect(
  Hello,
  Effect.gen(function* () {
    const GreeterView = yield* Greeter.Greeter;
    return (props: { readonly who: string }) => (
      <GreeterView name={props.who} />
    );
  }),
);
