import { Effect, Exit, Layer } from "effect";
import { afterEach, expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Policy from "../src/Policy";
import * as Node from "../src/Node";

// P5 (impossible-states): the http client transport starves at the browser's ~6-connection HTTP/1.1
// cap, shipping a blank dashboard. It now DIES loudly if built in a browser (window defined) instead of
// logging a warning that ships broken. ws (the browser transport) is unaffected. In Node
// (tests / servers) there's no `window`, so it's a no-op.

const setBrowser = () => Reflect.set(globalThis, "window", {});
afterEach(() => Reflect.deleteProperty(globalThis, "window"));

const buildLayer = <A, E>(layer: Layer.Layer<A, E, never>) =>
  Effect.runPromiseExit(Layer.build(layer).pipe(Effect.asVoid, Effect.scoped));

it("protocolHttp builds fine in a Node context (no window)", () =>
  buildLayer(Hyperlink.protocolHttp("http://127.0.0.1:9/rpc")).then((exit) =>
    expect(Exit.isSuccess(exit)).toBe(true),
  ));

it("protocolHttp DIES in a browser context (window defined)", () => {
  setBrowser();
  return buildLayer(Hyperlink.protocolHttp("http://x/rpc")).then((exit) => {
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("HttpClientInBrowser");
  });
});

it("the browser guard covers http (built on protocolHttp)", () => {
  setBrowser();
  class Edge extends Node.Service<Edge>()("guard/Edge", "http://x/rpc") {}
  return buildLayer(Edge.pipe(Node.connectHttp)).then((exit) => {
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("HttpClientInBrowser");
  });
});

it("ws is NOT guarded — it's the correct browser transport", () => {
  setBrowser();
  class Hub extends Node.Service<Hub>()("guard/Hub", { url: "wss://x/rpc" }) {}
  // This asserts the browser *guard* (no HttpClientInBrowser death), not connectivity — so opt out of
  // default-on client verify, which would otherwise eagerly probe the bogus `wss://x/rpc` and fail.
  return buildLayer(
    Hyperlink.ws(Hub, { url: "wss://x/rpc" }).pipe(
      Policy.provide(Policy.verifyOff),
    ),
  ).then((exit) => expect(Exit.isSuccess(exit)).toBe(true));
});
