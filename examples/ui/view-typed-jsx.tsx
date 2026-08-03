/**
 * Typed Views — nest child as a value, render with normal JSX.
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
/** @jsxImportSource last-ts */
import * as View from "last-ts/View";

class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "examples/ui/view-typed-jsx/Greeter",
) {}

// ---cut---
/** `yield*` Tag → R includes Greeter. */
export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter;
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  );
});

Hello;
// ^?

/** Use Hello (no yield) — pass as value, render with JSX. */
export const Middle = View.nest(Hello, (Hello) => (_props: {}) => (
  <aside data-demo="middle">
    <Hello who="nik" />
  </aside>
));

Middle;
// ^?

/** Use Middle the same way. */
export const Outer = View.nest(Middle, (Middle) => (_props: {}) => (
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
