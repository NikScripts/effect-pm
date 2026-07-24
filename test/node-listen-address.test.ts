import { describe, expect, it } from "vitest";
import { Tag } from "../src/internal/nodeCore";
import {
  coerceHttpListenOptions,
  coerceIpcListenArg,
  coerceWsListenOptions,
  httpListenUrlFromOptions,
  stampListenPath,
  stampListenUrl,
  wsListenUrlFromOptions,
} from "../src/internal/nodeListenCommon";

describe("nameless listen address options", () => {
  it("port → loopback http / ws urls", () => {
    expect(httpListenUrlFromOptions({ port: 3000 })).toBe(
      "http://127.0.0.1:3000/rpc",
    );
    expect(wsListenUrlFromOptions({ port: 3000 })).toBe(
      "ws://127.0.0.1:3000/rpc",
    );
  });

  it("positional shorthand → ListenOptions (port / :port / url / path)", () => {
    expect(coerceHttpListenOptions(3000)).toEqual({ port: 3000 });
    expect(coerceHttpListenOptions(":3000")).toEqual({ port: 3000 });
    expect(
      coerceHttpListenOptions("http://127.0.0.1:3000/rpc"),
    ).toEqual({ url: "http://127.0.0.1:3000/rpc" });
    expect(coerceWsListenOptions(3000)).toEqual({ port: 3000 });
    expect(coerceWsListenOptions("ws://127.0.0.1:3000/rpc")).toEqual({
      url: "ws://127.0.0.1:3000/rpc",
    });
    expect(coerceIpcListenArg("/tmp/x.sock")).toEqual({
      options: undefined,
      path: "/tmp/x.sock",
    });
    expect(coerceIpcListenArg({ unlink: true })).toEqual({
      options: { unlink: true },
      path: undefined,
    });
  });

  it("url wins over port; ws rewrites http(s) schemes", () => {
    expect(
      httpListenUrlFromOptions({
        port: 1,
        url: "http://127.0.0.1:4000/rpc",
      }),
    ).toBe("http://127.0.0.1:4000/rpc");
    expect(
      wsListenUrlFromOptions({ url: "http://127.0.0.1:4000/rpc" }),
    ).toBe("ws://127.0.0.1:4000/rpc");
    expect(
      wsListenUrlFromOptions({ url: "https://127.0.0.1:4000/rpc" }),
    ).toBe("wss://127.0.0.1:4000/rpc");
  });

  it("stampListenUrl fills address-less nodes; leaves addressed alone", () => {
    const bare = Tag()("listen-addr/bare", { kind: "Http" as const });
    const stamped = stampListenUrl(bare, "http://127.0.0.1:3000/rpc", "Http");
    expect(stamped.url).toBe("http://127.0.0.1:3000/rpc");
    expect(stamped.kind).toBe("Http");

    const already = Tag()("listen-addr/fixed", {
      url: "http://127.0.0.1:9/rpc",
      kind: "Http" as const,
    });
    expect(stampListenUrl(already, "http://127.0.0.1:3000/rpc", "Http").url).toBe(
      "http://127.0.0.1:9/rpc",
    );
    expect(stampListenUrl(bare, undefined, "Http").url).toBeUndefined();
  });

  it("stampListenPath fills address-less ipc nodes", () => {
    const bare = Tag()("listen-addr/ipc");
    expect(stampListenPath(bare, "/tmp/x.sock").path).toBe("/tmp/x.sock");
    const already = Tag()("listen-addr/ipc2", { path: "/tmp/a.sock" });
    expect(stampListenPath(already, "/tmp/b.sock").path).toBe("/tmp/a.sock");
  });
});
