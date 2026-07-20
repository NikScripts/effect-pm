import { Effect, Exit, Layer } from "effect";
import { afterEach, expect, it } from "vitest";
import * as Resource from "../src/Resource";

// P5 (impossible-states): the http client transport starves at the browser's ~6-connection HTTP/1.1
// cap, shipping a blank dashboard. It now DIES loudly if built in a browser (window defined) instead of
// logging a warning that ships broken. socketClient (the browser transport) is unaffected. In Node
// (tests / servers) there's no `window`, so it's a no-op.

const setBrowser = () => Reflect.set(globalThis, "window", {});
afterEach(() => Reflect.deleteProperty(globalThis, "window"));

const buildLayer = <A, E>(layer: Layer.Layer<A, E, never>) =>
  Effect.runPromiseExit(Layer.build(layer).pipe(Effect.asVoid, Effect.scoped));

it("protocolHttp builds fine in a Node context (no window)", () =>
  buildLayer(Resource.protocolHttp("http://127.0.0.1:9/rpc")).then((exit) =>
    expect(Exit.isSuccess(exit)).toBe(true),
  ));

it("protocolHttp DIES in a browser context (window defined)", () => {
  setBrowser();
  return buildLayer(Resource.protocolHttp("http://x/rpc")).then((exit) => {
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("HttpClientInBrowser");
  });
});

it("the browser guard covers httpClient (built on protocolHttp)", () => {
  setBrowser();
  class Edge extends Resource.Node<Edge>("guard/Edge", "http://x/rpc") {}
  return buildLayer(Edge.pipe(Resource.connectHttp)).then((exit) => {
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("HttpClientInBrowser");
  });
});

it("socketClient is NOT guarded — it's the correct browser transport", () => {
  setBrowser();
  class Hub extends Resource.Node<Hub>("guard/Hub", { url: "wss://x/rpc" }) {}
  return buildLayer(Resource.socketClient(Hub, { url: "wss://x/rpc" })).then((exit) =>
    expect(Exit.isSuccess(exit)).toBe(true),
  );
});
