import { describe, expect, it } from "vitest";
import { Tag } from "../src/internal/nodeCore";
import {
  httpListenUrlFromOptions,
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
});
