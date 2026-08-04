/**
 * Typed Views — Service.layer + gen + mount.
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
/** @jsxImportSource last-ts */
import * as View from "last-ts/View";

class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "examples/ui/view-typed-jsx/Greeter",
  {
    default: (props) => (
      <span data-demo="inner">hello {props.name}</span>
    ),
  },
) {}

// ---cut---
/** Open R from yield* Service — not legal as JSX until mount. */
export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter;
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  );
});

Hello;
// ^?

/** Nested chrome; default layer from {@link Greeter.layer}. */
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
  Greeter.layer,
);

App;
// ^?
