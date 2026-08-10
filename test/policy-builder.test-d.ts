/**
 * PolicyBuilder type locks — Schema keys; tagged fragments; distinct brands.
 */
import { Schema, type Layer } from "effect";
import type { Policy as BuilderPolicy } from "../src/PolicyBuilder";
import * as PolicyBuilder from "../src/PolicyBuilder";
import type { Policy as EngPolicy } from "../src/Policy";
import * as Policy from "../src/Policy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const bSchema = Schema.Literals(["x", "y"]);

class Demo extends PolicyBuilder.make("policy-builder-d/Demo")
  .key("A", Schema.Boolean, { defaultValue: () => true })
  .key("B", bSchema, {
    defaultValue: (): Schema.Schema.Type<typeof bSchema> => "x",
  }) {}

const made = Demo.make({ A: true, B: "y" });
const fromFrags = Demo.make([
  { _tag: "A", value: true },
  { _tag: "B", value: "y" },
]);
const piped = made.pipe(Demo.layer(Demo.succeed({ _tag: "A", value: false })));
const single = Demo.succeed({ _tag: "A", value: true });

type _Checks = [
  AssertExtends<typeof made, Layer.Layer<never>>,
  AssertExtends<
    typeof made,
    BuilderPolicy<"policy-builder-d/Demo", { A: true; B: "y" }>
  >,
  AssertExtends<
    typeof fromFrags,
    BuilderPolicy<"policy-builder-d/Demo", { A: true; B: "y" }>
  >,
  AssertExtends<
    typeof piped,
    BuilderPolicy<"policy-builder-d/Demo", { A: false; B: "y" }>
  >,
  AssertExtends<
    typeof single,
    BuilderPolicy<"policy-builder-d/Demo", { A: true }>
  >,
  AssertExtends<typeof Policy.sticky, EngPolicy<{ Sticky: true }>>,
  AssertEqual<
    PolicyBuilder.FragmentOfKeys<(typeof Demo)["keys"]>,
    | { readonly _tag: "A"; readonly value: boolean }
    | { readonly _tag: "B"; readonly value: "x" | "y" }
  >,
];

// @ts-expect-error — Demo brand is not Eng’d Policy brand
export const _cross: EngPolicy<{ Sticky: true }> = Demo.succeed({
  _tag: "A",
  value: true,
});

// @ts-expect-error — two-arg succeed removed
Demo.succeed("A", true);

export type { _Checks };
