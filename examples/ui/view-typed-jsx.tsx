/**
 * Typed Views — bag compose + mount.
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

/** Bag form — keep the name `Hello`, render with JSX; R merges. */
export const Middle = View.succeed({ Hello }, ({ Hello }) => (_props: {}) => (
  <aside data-demo="middle">
    <Hello who="nik" />
  </aside>
));

Middle;
// ^?

/** Same for Middle → Outer. */
export const Outer = View.succeed({ Middle }, ({ Middle }) => (_props: {}) => (
  <div data-demo="outer">
    <section>
      <article>
        <Middle />
      </article>
    </section>
  </div>
));

Outer;
// ^?

/** Edge — Layer discharges Greeter; result is JSX-legal. */
export const App = View.mount(
  Outer,
  Greeter.provide((props) => <span data-demo="inner">hello {props.name}</span>),
);

App;
// ^?
