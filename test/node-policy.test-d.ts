/**
 * NodePolicy type locks — distinct brand from LookupPolicy.
 */
import type { Layer } from "effect";
import type { Policy as NodePol } from "../src/NodePolicy";
import * as NodePolicy from "../src/NodePolicy";
import type { Policy as LookupPol } from "../src/LookupPolicy";
import * as LookupPolicy from "../src/LookupPolicy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;

const made = NodePolicy.make({
  Listen: "all",
  Advertise: "primary",
  As: "A",
});
const via = NodePolicy.listen(["A"]);
const proxied = NodePolicy.proxy("prefer");

type _Checks = [
  AssertExtends<typeof made, Layer.Layer<never>>,
  AssertExtends<
    typeof made,
    NodePol<{ Listen: "all"; Advertise: "primary"; As: "A" }>
  >,
  AssertExtends<typeof via, NodePol<{ Listen: readonly ["A"] }>>,
  AssertExtends<typeof proxied, NodePol<{ Proxy: "prefer" }>>,
  AssertExtends<typeof LookupPolicy.sticky, LookupPol<{ Sticky: true }>>,
];

// @ts-expect-error — Node brand is not Lookup brand
export const _cross: LookupPol<{ Sticky: true }> = NodePolicy.listen("all");

// @ts-expect-error — Lookup brand is not Node brand
export const _cross2: NodePol<{ Listen: "all" }> = LookupPolicy.sticky;

export type { _Checks };
