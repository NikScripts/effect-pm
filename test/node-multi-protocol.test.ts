import { expect, it } from "vitest";
import * as Node from "../src/Node";

// The { http, ws } shorthand declares one node reachable over both transports — same key, same
// served resources, two endpoints.
class Droplet extends Node.Service<Droplet>()("mp/droplet", {
  http: "http://droplet:7777/rpc",
  ws: "ws://droplet:7777/rpc",
}) {}

// A single-protocol node is just the one-endpoint case.
class Single extends Node.Service<Single>()("mp/single", {
  url: "http://x/rpc",
  kind: "Http",
}) {}

it("the { http, ws } shorthand builds a node with both transports", () => {
  expect(Droplet.endpoints).toEqual({
    Http: { url: "http://droplet:7777/rpc" },
    WebSocket: { url: "ws://droplet:7777/rpc" },
  });
  // primary (for single-protocol readers) is http > ws > ipc
  expect(Droplet.kind).toBe("Http");
  expect(Droplet.url).toBe("http://droplet:7777/rpc");
});

it("a single-protocol node is the one-entry case, unchanged", () => {
  const single: Node.AnyNode = Single; // every node is an AnyNode (endpoints readable there)
  expect(single.endpoints).toEqual({ Http: { url: "http://x/rpc" } });
  expect(Single.kind).toBe("Http");
});
