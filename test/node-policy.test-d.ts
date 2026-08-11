/**
 * NodePolicy type locks — PascalCase modes; distinct brand from LookupPolicy.
 */
import type { Layer } from "effect";
import type { Policy as NodePol } from "../src/NodePolicy";
import * as NodePolicy from "../src/NodePolicy";
import type { Policy as LookupPol } from "../src/LookupPolicy";
import * as LookupPolicy from "../src/LookupPolicy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;

const made = NodePolicy.make({
  PrimaryAddress: "AllUnlabeled",
  Listen: "All",
  Advertise: "Primary",
  Active: "A",
  As: "A",
});
const via = NodePolicy.listen(["A"]);
const proxied = NodePolicy.proxy("Prefer");
const active = NodePolicy.active("A");
const primary = NodePolicy.primaryAddress("AllUnlabeled");

type _Checks = [
  AssertExtends<typeof made, Layer.Layer<never>>,
  AssertExtends<
    typeof made,
    NodePol<{
      PrimaryAddress: "AllUnlabeled";
      Listen: "All";
      Advertise: "Primary";
      Active: "A";
      As: "A";
    }>
  >,
  AssertExtends<typeof via, NodePol<{ Listen: readonly ["A"] }>>,
  AssertExtends<typeof proxied, NodePol<{ Proxy: "Prefer" }>>,
  AssertExtends<typeof active, NodePol<{ Active: "A" }>>,
  AssertExtends<
    typeof primary,
    NodePol<{ PrimaryAddress: "AllUnlabeled" }>
  >,
  AssertExtends<typeof LookupPolicy.sticky, LookupPol<{ Sticky: true }>>,
];

// @ts-expect-error — Node brand is not Lookup brand
export const _cross: LookupPol<{ Sticky: true }> = NodePolicy.listen("All");

// @ts-expect-error — Lookup brand is not Node brand
export const _cross2: NodePol<{ Listen: "All" }> = LookupPolicy.sticky;

// @ts-expect-error — owned modes are PascalCase
NodePolicy.listen("all");

// @ts-expect-error — owned modes are PascalCase
NodePolicy.proxy("prefer");

export type { _Checks };
