/**
 * @module examples/ui/view-typed-jsx/ui/Frame
 *
 * Leaf shell Views — DOM defaults only. Composition places these; it never owns tags.
 */
import type * as React from "react";
import * as View from "last-ts/View";

export class Outer extends View.make<Outer, {
  readonly children?: React.ReactNode;
}>()(
  "examples/ui/view-typed-jsx/Outer",
  (props) => (
    <div data-demo="outer">
      <section>
        <article>{props.children}</article>
      </section>
    </div>
  ),
) {}

export class Middle extends View.make<Middle, {
  readonly children?: React.ReactNode;
}>()(
  "examples/ui/view-typed-jsx/Middle",
  (props) => <aside data-demo="middle">{props.children}</aside>,
) {}
