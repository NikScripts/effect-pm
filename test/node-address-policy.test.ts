/**
 * PrimaryAddress / Listen / Advertise resolution against address lists.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Address from "../src/Address";
import * as Node from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";

describe("Node address policy resolve", () => {
  it("AllUnlabeled primary + Advertise Primary → unlabeled only", () => {
    class Worker extends Node.make(
      "test/addr-policy/Worker",
      Address.http(":8080"),
    ).pipe(
      Address.unix("A", "/tmp/w.a.sock"),
      Address.unix("B", "/tmp/w.b.sock"),
      NodePolicy.primaryAddress("AllUnlabeled"),
      NodePolicy.advertise("Primary"),
    ) {}

    const resolved = Node.resolvedAddressesOf(Worker);
    expect(resolved?.primary).toHaveLength(1);
    expect(resolved?.primary[0]?.label).toBeUndefined();
    expect(resolved?.advertise).toHaveLength(1);
    expect(resolved?.listen).toHaveLength(3);
    expect(
      (Worker as unknown as { readonly kind: string }).kind,
    ).toBe("Http");
  });

  it("listen label list stamps bind dial; advertise resolve stays separate", () => {
    class SideA extends Node.make(
      "test/addr-policy/SideA",
      Address.http(":8080"),
    ).pipe(
      Address.unix("A", "/tmp/side-a.sock"),
      NodePolicy.listen(["A"]),
      NodePolicy.advertise(["A"]),
      NodePolicy.as("A"),
    ) {}

    // Bind surface = listen set (not advertise).
    expect(
      (SideA as unknown as { readonly kind: string }).kind,
    ).toBe("IpcSocket");
    expect(
      (SideA as unknown as { readonly path: string }).path,
    ).toBe("/tmp/side-a.sock");
    expect(Node.resolvedAddressesOf(SideA)?.advertise).toHaveLength(1);
  });

  it("unknown As label throws via resolve", () => {
    expect(() =>
      Node.resolveNodeAddresses(
        "test/addr-policy/BadAs",
        [Address.http(":8080"), Address.unix("A", "/tmp/a.sock")],
        { As: "C" },
      ),
    ).toThrow(Node.UnknownAddressLabel);
  });

  it("unknown listen label throws via resolve", () => {
    expect(() =>
      Node.resolveNodeAddresses(
        "test/addr-policy/BadListen",
        [Address.http(":8080"), Address.unix("A", "/tmp/a.sock")],
        { Listen: ["Z"] },
      ),
    ).toThrow(Node.UnknownAddressLabel);
  });

  it("EmptyPrimarySet deferred at make; loud via resolve", () => {
    class LabeledOnly extends Node.make(
      "test/addr-policy/LabeledOnly",
      Address.unix("A", "/tmp/only-a.sock"),
    ) {}

    // Intermediate / default Advertise Primary with empty AllUnlabeled set —
    // make succeeds (pipe may still fix); resolve is loud.
    expect(Node.addressesOf(LabeledOnly)).toHaveLength(1);
    expect(() => Node.resolvedAddressesOf(LabeledOnly)).toThrow(
      Node.EmptyPrimarySet,
    );

    class Fixed extends Node.make(
      "test/addr-policy/LabeledFixed",
      Address.unix("A", "/tmp/only-a.sock"),
    ).pipe(NodePolicy.primaryAddress(["A"])) {}

    expect(Node.resolvedAddressesOf(Fixed)?.advertise).toHaveLength(1);
  });

  it("dual unlabeled Http kept as primary list (not last-wins)", () => {
    class Dual extends Node.make("test/addr-policy/Dual", [
      Address.http(":8080"),
      Address.http(":8081"),
    ]).pipe(NodePolicy.advertise("Primary")) {}

    const resolved = Node.resolvedAddressesOf(Dual);
    expect(resolved?.primary).toHaveLength(2);
    expect(resolved?.advertise).toHaveLength(2);
  });
});
