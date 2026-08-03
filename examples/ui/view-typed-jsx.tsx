/**
 * Typed JSX demo — two View values; Outer nests Inner deeply.
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

/**
 * Outer — no yield*; nests Inner several levels deep.
 * Hover `Outer` — R includes Greeter from the nested Inner.
 */
export const Outer = View.stamp<{}, View.ServicesOf<typeof Inner>>(
  (_props: {}) => (
    <div data-demo="outer">
      <section>
        <article>
          <aside>
            <Inner />
          </aside>
        </article>
      </section>
    </div>
  ),
);

Outer;
// ^?
