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
});
