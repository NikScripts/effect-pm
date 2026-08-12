/**
 * PolicyBuilder type locks — References on Def; distinct brands.
 */
import { Schema, type Layer } from "effect";
import type { Policy as BuilderPolicy } from "../src/PolicyBuilder";
import * as PolicyBuilder from "../src/PolicyBuilder";
import type { Policy as EngPolicy } from "../src/LookupPolicy";
import * as LookupPolicy from "../src/LookupPolicy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const bSchema = Schema.Literals(["x", "y"]);

class DemoPolicies extends PolicyBuilder.make("policy-builder-d/Demo")
  .key("A", Schema.Boolean, { defaultValue: () => true })
  .key("B", bSchema, {
    defaultValue: (): Schema.Schema.Type<typeof bSchema> => "x",
  }) {}

const made = DemoPolicies.make({ A: true, B: "y" });
const fromFrags = DemoPolicies.make([
  { _tag: "A", value: true },
  { _tag: "B", value: "y" },
]);
const piped = made.pipe(DemoPolicies.layer(DemoPolicies.succeed({ _tag: "A", value: false })));
const single = DemoPolicies.succeed({ _tag: "A", value: true });
const matched = DemoPolicies.matchFragment({ _tag: "A", value: true }, {
  A: (x) => x.value,
  B: (x) => x.value,
});
const viaMethod = DemoPolicies.a(true);
const viaMethodB = DemoPolicies.b("y");

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
  AssertExtends<
    typeof viaMethod,
    BuilderPolicy<"policy-builder-d/Demo", { A: true }>
  >,
  AssertExtends<
    typeof viaMethodB,
    BuilderPolicy<"policy-builder-d/Demo", { B: "y" }>
  >,
  AssertExtends<typeof LookupPolicy.sticky, EngPolicy<{ Sticky: true }>>,
  AssertEqual<
    PolicyBuilder.FragmentOfKeys<(typeof DemoPolicies)["keys"]>,
    | { readonly _tag: "A"; readonly value: boolean }
    | { readonly _tag: "B"; readonly value: "x" | "y" }
  >,
  AssertExtends<typeof matched, boolean | "x" | "y">,
];

// @ts-expect-error — Demo brand is not Eng’d Policy brand
export const _cross: EngPolicy<{ Sticky: true }> = DemoPolicies.a(true);

// @ts-expect-error — two-arg succeed removed
DemoPolicies.succeed("A", true);

// @ts-expect-error — Layer method is Uncapitalize(tag), not PascalCase
DemoPolicies.A(true);

export type { _Checks };
