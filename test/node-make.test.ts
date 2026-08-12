/**
 * Node.make — address list + pipe Address / NodePolicy.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Address from "../src/Address";
import * as Node from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";

describe("Node.make", () => {
  it("accumulates addresses via make arg and pipe; stamps NodePolicy", () => {
    class Worker extends Node.make(
      "test/node-make/Worker",
      Address.http(":8080"),
    ).pipe(
      Address.unix("A", "/tmp/w.a.sock"),
      Address.unix("B", "/tmp/w.b.sock"),
      NodePolicy.proxy("Prefer"),
      NodePolicy.primaryAddress("AllUnlabeled"),
    ) {}

    const addresses = Node.addressesOf(Worker);
    expect(addresses).toHaveLength(3);
    expect(addresses?.[0]?.label).toBeUndefined();
    expect(addresses?.[1]?.label).toBe("A");
    expect(addresses?.[2]?.label).toBe("B");

    expect(Node.nodePolicyOf(Worker)).toEqual({
      Proxy: "Prefer",
      PrimaryAddress: "AllUnlabeled",
    });
    expect(Worker.key).toBe("test/node-make/Worker");
    expect(
      (Worker as unknown as { readonly kind: string }).kind,
    ).toBe("Http");
  });

  it("array make + listen/as policy; dual unlabeled Http kept", () => {
    class Dual extends Node.make("test/node-make/Dual", [
      Address.http(":8080"),
      Address.http(":8081"),
    ]).pipe(NodePolicy.advertise("Primary")) {}

    expect(Node.addressesOf(Dual)).toHaveLength(2);
    expect(Node.nodePolicyOf(Dual)).toEqual({ Advertise: "Primary" });
  });

  it("unixFromKey sentinel alone", () => {
    class Local extends Node.make(
      "test/node-make/Local",
      Address.unixFromKey,
    ) {}
    expect(Node.addressesOf(Local)?.[0]).toEqual(Address.unixFromKey);
    expect(
      (Local as unknown as { readonly kind: string }).kind,
    ).toBe("IpcSocket");
  });

  it("dial overlap on pipe throws", () => {
    expect(() =>
      Node.make("test/node-make/Overlap", Address.http(":8080")).pipe(
        Address.http(8080),
      ),
    ).toThrow(Address.DialOverlap);
  });
});
