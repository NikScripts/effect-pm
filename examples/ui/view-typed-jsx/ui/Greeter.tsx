/**
 * @module examples/ui/view-typed-jsx/ui/Greeter
 *
 * Leaf View — DOM lives in the `View.make` default (Reference). No `static layer`.
 */
import * as View from "last-ts/View";

export class Greeter extends View.make<Greeter, { readonly name: string }>()(
  "examples/ui/view-typed-jsx/Greeter",
  (props) => <span data-demo="inner">hello {props.name}</span>,
) {}
