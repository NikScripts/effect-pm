/**
 * Typed JSX demo — Inner → plain Middle → Outer.
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
/** @jsxImportSource last-ts */
import { Context } from "effect";
import * as View from "last-ts/View";

export class Greeter extends Context.Service<Greeter, string>()(
  "examples/ui/view-typed-jsx/Greeter",
) {}

// ---cut---
/** Inner — needs Greeter. Hover `Inner` below. */
export const Inner = View.gen(function* () {
  const name = yield* Greeter;
  return (_props: {}) => <span data-demo="inner">hello {name}</span>;
});

Inner;
// ^?

/** Plain middle — not a View. Nests Inner. */
export function Middle(_props: {}) {
  return (
    <aside data-demo="middle">
      <Inner />
    </aside>
  );
}

/**
 * Outer — `View.stamp` with no type args; nests Middle (which nests Inner).
 * Hover `Outer`.
 */
export const Outer = View.stamp((_props: {}) => (
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
