/**
 * PolicyBuilder type locks — class extends make+key; families are distinct brands.
 */
import { Context, type Layer } from "effect";
import type { Policy as BuilderPolicy } from "../src/PolicyBuilder";
import * as PolicyBuilder from "../src/PolicyBuilder";
import type { Policy as EngPolicy } from "../src/Policy";
import * as Policy from "../src/Policy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;

const A = Context.Reference<boolean>("policy-builder-d/A", {
  defaultValue: (): boolean => true,
});
const B = Context.Reference<"x" | "y">("policy-builder-d/B", {
  defaultValue: (): "x" => "x",
});

class Demo extends PolicyBuilder.make("policy-builder-d/Demo")
  .key("A", A)
  .key("B", B) {}

const made = Demo.make({ A: true, B: "y" });
const piped = made.pipe(Demo.layer(Demo.succeed("A", false)));

type _Checks = [
  AssertExtends<typeof made, Layer.Layer<never>>,
  AssertExtends<
    typeof made,
    BuilderPolicy<"policy-builder-d/Demo", { A: true; B: "y" }>
  >,
  AssertExtends<
    typeof piped,
    BuilderPolicy<"policy-builder-d/Demo", { A: false; B: "y" }>
  >,
  AssertExtends<typeof Policy.sticky, EngPolicy<{ Sticky: true }>>,
];

// @ts-expect-error — Demo family is not Eng’d Policy brand
export const _cross: EngPolicy<{ Sticky: true }> = Demo.succeed("A", true);

export type { _Checks };
