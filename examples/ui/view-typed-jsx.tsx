/**
 * Typed Views — Service + Layer.succeed/effect + View.mount(Service).
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
/** @jsxImportSource last-ts */
import { Effect, Layer } from "effect";
import * as View from "last-ts/View";

class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "examples/ui/view-typed-jsx/Greeter",
) {
  static layer = Layer.succeed(Greeter, (props) => (
    <span data-demo="inner">hello {props.name}</span>
  ));
}

class Hello extends View.Service<Hello, { readonly who: string }>()(
  "examples/ui/view-typed-jsx/Hello",
) {
  static layer = Layer.effect(
    Hello,
    Effect.gen(function* () {
      const GreeterView = yield* Greeter;
      return (props: { readonly who: string }) => (
        <GreeterView name={props.who} />
      );
    }),
  ).pipe(Layer.provide(Greeter.layer));
}

class AppRoot extends View.Service<AppRoot>()(
  "examples/ui/view-typed-jsx/App",
) {
  static layer = Layer.effect(
    AppRoot,
    Effect.gen(function* () {
      const HelloView = yield* Hello;
      return (_props: {}) => (
        <div data-demo="outer">
          <section>
            <article>
              <aside data-demo="middle">
                <HelloView who="nik" />
              </aside>
            </article>
          </section>
        </div>
      );
    }),
  ).pipe(Layer.provide(Hello.layer));
}

/** Yield* Services; mount the root Service. */
export const App = View.mount(AppRoot);

App;
// ^?
