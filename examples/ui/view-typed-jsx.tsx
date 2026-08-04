/**
 * Typed Views — Service + View.succeed/gen Layers + mount.
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
/** @jsxImportSource last-ts */
import { Layer } from "effect";
import * as View from "last-ts/View";

class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "examples/ui/view-typed-jsx/Greeter",
) {
  static layer = View.succeed(Greeter, (props) => (
    <span data-demo="inner">hello {props.name}</span>
  ));
}

class Hello extends View.Service<Hello, { readonly who: string }>()(
  "examples/ui/view-typed-jsx/Hello",
) {
  static layer = View.gen(Hello, function* () {
    const GreeterView = yield* Greeter;
    return (props: { readonly who: string }) => (
      <GreeterView name={props.who} />
    );
  });
}

Hello;
// ^?

class AppRoot extends View.Service<AppRoot>()(
  "examples/ui/view-typed-jsx/App",
) {
  static layer = View.gen(AppRoot, function* () {
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
  });
}

/** Nested chrome — yield* Services; mount at the edge. */
export const App = View.mount(
  AppRoot,
  AppRoot.layer.pipe(
    Layer.provide(Hello.layer),
    Layer.provide(Greeter.layer),
  ),
);

App;
// ^?
