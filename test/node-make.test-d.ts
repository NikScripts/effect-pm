/**
 * Node.make type locks — LabelsOf from address list.
 */
import * as Address from "../src/Address";
import * as Node from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const made = Node.make("d/Worker", Address.http(":8080")).pipe(
  Address.unix("A", "/tmp/a.sock"),
  Address.unix("B", "/tmp/b.sock"),
  NodePolicy.as("A"),
);

type Labels = (typeof made)["labels"];
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
];

// @ts-expect-error — lowercase owned NodePolicy mode rejected at NodePolicy API
NodePolicy.listen("all");

export type { _Checks, AddressList };
