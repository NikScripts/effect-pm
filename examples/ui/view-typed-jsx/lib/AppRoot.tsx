/**
 * @module examples/ui/view-typed-jsx/lib/AppRoot
 *
 * Composition View — zero DOM tags; place Frame + Hello via `yield*`.
 */
import { Effect, Layer } from "effect";
import * as View from "last-ts/View";
import * as Frame from "../ui/Frame";
import * as Hello from "./Hello";

export class AppRoot extends View.make<AppRoot>()(
  "examples/ui/view-typed-jsx/App",
) {}

export const appLayer = Layer.effect(
  AppRoot,
  Effect.gen(function* () {
    const HelloView = yield* Hello.Hello;
    const OuterView = yield* Frame.Outer;
    const MiddleView = yield* Frame.Middle;
    return (_props: {}) => (
      <OuterView>
        <MiddleView>
          <HelloView who="nik" />
        </MiddleView>
      </OuterView>
    );
  }),
).pipe(Layer.provide(Hello.helloLayer));
