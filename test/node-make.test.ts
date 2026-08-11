/**
 * Node.make — public class + private pipe (Address / NodePolicy).
 */
import { describe, expect, it } from "@effect/vitest";
import * as Address from "../src/Address";
import * as Node from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";

describe("Node.make", () => {
  it("public make; private extends Public.pipe (Address bag + NodePolicy)", () => {
    class Worker extends Node.make(
      "test/node-make/Worker",
      Address.http(":8080"),
    ) {}

    class WorkerPrivate extends Worker.pipe(
      Address.unix({
        A: "/tmp/w.a.sock",
        B: "/tmp/w.b.sock",
      }),
      NodePolicy.proxy("Prefer"),
      NodePolicy.primaryAddress("AllUnlabeled"),
    ) {}

    expect(Node.addressesOf(Worker)).toHaveLength(1);
    expect(Node.addressesOf(Worker)?.[0]?.label).toBeUndefined();

    const addresses = Node.addressesOf(WorkerPrivate);
    expect(addresses).toHaveLength(3);
    expect(addresses?.[0]?.label).toBeUndefined();
    expect(addresses?.[1]?.label).toBe("A");
    expect(addresses?.[2]?.label).toBe("B");

    expect(Node.nodePolicyOf(WorkerPrivate)).toEqual({
      Proxy: "Prefer",
      PrimaryAddress: "AllUnlabeled",
    });
    expect(Worker.key).toBe("test/node-make/Worker");
    expect(WorkerPrivate.key).toBe(Worker.key);
    expect(
      (Worker as unknown as { readonly kind: string }).kind,
    ).toBe("Http");
  });

  it("Node.make(key) empty then pipe addresses", () => {
    class Bare extends Node.make("test/node-make/Bare") {}
    class WithHttp extends Bare.pipe(Address.http(":9090")) {}

    expect(Node.addressesOf(Bare)).toHaveLength(0);
    expect(Node.addressesOf(WithHttp)).toHaveLength(1);
    expect(WithHttp.key).toBe("test/node-make/Bare");
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
