/**
 * Address factories — optional labels; overlap reject; unixFromKey sentinel.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Address from "../src/Address";

describe("Address", () => {
  it("http scalar / array / labeled object", () => {
    const one = Address.http(":8080");
    expect(one.label).toBeUndefined();
    expect(one.kind).toBe("Http");
    expect(one.dial).toEqual({ _tag: "HttpPort", port: 8080 });

    const many = Address.http([8080, 8081]);
    expect(many).toHaveLength(2);
    expect(many.every((a) => a.label === undefined)).toBe(true);

    const labeled = Address.http({ A: 3000, B: 3001 });
    expect(labeled.map((a) => a.label).sort()).toEqual(["A", "B"]);
  });

  it("unix unlabeled vs labeled; unixFromKey is sentinel (no call)", () => {
    const path = Address.unix("/tmp/w.sock");
    expect(path.label).toBeUndefined();
    expect(path.kind).toBe("IpcSocket");

    const a = Address.unix("A", "/var/run/w.a.sock");
    expect(a.label).toBe("A");
    expect(a.dial).toEqual({ _tag: "UnixPath", path: "/var/run/w.a.sock" });

    expect(Address.isUnixFromKey(Address.unixFromKey)).toBe(true);
    expect(Address.unixFromKey.kind).toBe("IpcSocket");
  });

  it("dial overlap rejects same concrete dial", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.http(":8080"),
        Address.http(8080),
      ]),
    ).toThrow(Address.DialOverlap);
  });

  it("multiple unlabeled same protocol do not overlap when dials differ", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.http(":8080"),
        Address.http(":8081"),
      ]),
    ).not.toThrow();
  });

  it("identity is the socket a dial resolves to, not how it was written", () => {
    // `nodeMake` derives `http://localhost:<port>/rpc` from a bare port, so these are one listener.
    const port = Address.dialIdentity(Address.http(8080));
    expect(Address.dialIdentity(Address.http(":8080"))).toBe(port);
    expect(Address.dialIdentity(Address.http("http://localhost:8080/rpc"))).toBe(port);
    expect(Address.dialIdentity(Address.http("http://127.0.0.1:8080/rpc"))).toBe(port);
  });

  it("a bare port overlaps the loopback url it derives to", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.http(8080),
        Address.http("http://localhost:8080/rpc"),
      ]),
    ).toThrow(Address.DialOverlap);
  });

  it("bind-any covers loopback on the same port", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.http("http://0.0.0.0:8080/rpc"),
        Address.http(8080),
      ]),
    ).toThrow(Address.DialOverlap);
  });

  it("bind-any on another port does not overlap", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.http("http://0.0.0.0:8081/rpc"),
        Address.http(8080),
      ]),
    ).not.toThrow();
  });

  it("http and ws on one port stay distinct — upgrade-on-the-same-server is legitimate", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.http(":8080"),
        Address.ws("ws://localhost:8080/rpc"),
      ]),
    ).not.toThrow();
  });

  it("a scheme's default port is the port", () => {
    expect(Address.dialIdentity(Address.http("https://api.acme.com/rpc"))).toBe(
      Address.dialIdentity(Address.http("https://api.acme.com:443/rpc")),
    );
  });

  it("unix paths overlap only when identical", () => {
    expect(() =>
      Address.assertNoDialOverlap([
        Address.unix("A", "/tmp/w.sock"),
        Address.unix("B", "/tmp/w.sock"),
      ]),
    ).toThrow(Address.DialOverlap);

    expect(() =>
      Address.assertNoDialOverlap([
        Address.unix("A", "/tmp/a.sock"),
        Address.unix("B", "/tmp/b.sock"),
      ]),
    ).not.toThrow();
  });
});
