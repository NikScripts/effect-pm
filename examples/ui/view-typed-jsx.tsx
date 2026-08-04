/**
 * Typed Views — gen + mount (Tags via yield*).
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
/** @jsxImportSource last-ts */
import * as View from "last-ts/View";

class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "examples/ui/view-typed-jsx/Greeter",
) {}

// ---cut---
/** Open R from yield* Tag — not legal as JSX until mount. */
export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter;
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  );
});

Hello;
// ^?

/**
 * Nested chrome around a mounted child — only {@link View.Component}s in JSX.
 * Open-`R` values are mounted at the edge, not bag-composed.
 */
export const App = View.mount(
  View.gen(function* () {
    const GreeterView = yield* Greeter;
    return (_props: {}) => (
      <div data-demo="outer">
        <section>
          <article>
            <aside data-demo="middle">
              <GreeterView name="nik" />
            </aside>
          </article>
        </section>
      </div>
    );
  }),
  Greeter.provide((props) => (
    <span data-demo="inner">hello {props.name}</span>
  )),
);

App;
// ^?
