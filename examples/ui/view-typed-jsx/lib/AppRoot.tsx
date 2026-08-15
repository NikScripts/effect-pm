/**
 * @module examples/ui/view-typed-jsx/lib/AppRoot
 *
 * Composition View — zero DOM tags; place Frame + Hello via `yield*`.
 */
import { Effect, Layer } from "effect";
import * as View from "last-ts/View";
import { Outer, Middle } from "../ui/Frame";
import { Hello, helloLayer } from "./Hello";

export class AppRoot extends View.make<AppRoot>()(
  "examples/ui/view-typed-jsx/App",
) {}

export const appLayer = Layer.effect(
  AppRoot,
  Effect.gen(function* () {
    const HelloView = yield* Hello;
    const OuterView = yield* Outer;
    const MiddleView = yield* Middle;
    return (_props: {}) => (
      <OuterView>
        <MiddleView>
          <HelloView who="nik" />
        </MiddleView>
      </OuterView>
    );
  }),
).pipe(Layer.provide(helloLayer));
