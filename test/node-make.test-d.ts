/**
 * Node.make type locks — LabelsOf from address list; label-constrained NodePolicy.
 */
import * as Address from "../src/Address";
import * as Node from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const publicNode = Node.make("d/Worker", Address.http(":8080"));
const privateNode = publicNode.pipe(
  Address.unix({ A: "/tmp/a.sock", B: "/tmp/b.sock" }),
  NodePolicy.as("A"),
);

type Labels = (typeof privateNode)["labels"];
type AddressList = NonNullable<ReturnType<typeof Node.addressesOf>>;

type _Checks = [
  AssertExtends<"A", Labels>,
  AssertExtends<"B", Labels>,
  AssertEqual<Labels, "A" | "B">,
  AssertExtends<
    Address.LabelsOf<
      readonly [
        Address.Address<undefined, "Http">,
        Address.Address<"A", "IpcSocket">,
      ]
    >,
    "A"
  >,
  AssertEqual<
    Node.PolicyLabelsOk<"A" | "B", { As: "A"; Listen: readonly ["B"] }>,
    true
  >,
  AssertEqual<Node.PolicyLabelsOk<"A", { As: "C" }>, false>,
  AssertEqual<Node.PolicyLabelsOk<"A", { Listen: readonly ["Z"] }>, false>,
];

// @ts-expect-error — lowercase owned NodePolicy mode rejected at NodePolicy API
NodePolicy.listen("all");

// @ts-expect-error — As label not on this node's addresses
class _BadAs extends Node.make("d/BadAs", Address.http(":8080")).pipe(
  Address.unix("A", "/tmp/a.sock"),
  NodePolicy.as("C"),
) {}

// @ts-expect-error — listen label list not on this node's addresses
class _BadListen extends Node.make("d/BadListen", Address.http(":8080")).pipe(
  Address.unix("A", "/tmp/a.sock"),
  NodePolicy.listen(["Z"]),
) {}

export type { _Checks, AddressList };
