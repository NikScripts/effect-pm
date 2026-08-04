import { expect, it, afterEach } from "vitest";
import * as Node from "../src/Node";
import { selectEndpoint } from "../src/internal/nodeConnect";

class Multi extends Node.Service<Multi>()("cs/multi", {
  http: "http://h/rpc",
  ws: "ws://h/rpc",
}) {}
class HttpOnly extends Node.Service<HttpOnly>()("cs/http", {
  url: "http://h/rpc",
  kind: "Http",
}) {}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

it("server env (no window): a multi node dials Http", () => {
  expect(selectEndpoint(Multi)).toEqual({ kind: "Http", url: "http://h/rpc" });
});

it("browser env: a multi node prefers WebSocket (dodges the ~6-conn cap / http death)", () => {
  Object.assign(globalThis, { window: {} });
  expect(selectEndpoint(Multi)).toEqual({
    kind: "WebSocket",
    url: "ws://h/rpc",
  });
});

it("a single-protocol node dials its one endpoint regardless of env", () => {
  expect(selectEndpoint(HttpOnly)).toEqual({ kind: "Http", url: "http://h/rpc" });
  Object.assign(globalThis, { window: {} });
  expect(selectEndpoint(HttpOnly)).toEqual({ kind: "Http", url: "http://h/rpc" });
});
