import { Duration, Effect, Layer, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as QueueResource from "../src/QueueResource";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// `Node.connect` and its `connectHttp` / `connectSocket` shortcuts are dual (data-first + pipeable
// data-last) AND, in the node-only form, derive the transport from the node's declared `kind` — so the
// http↔socket mismatch that caused the dashboard's "no live data" bug can't be expressed. This proves
// the dispatch mechanics, the ProtocolKind stamping, and that a node-derived ws client round-trips.

describe("Node ProtocolKind inference", () => {
  it("infers WebSocket from a ws url, Http from a port, IpcSocket from path, honors explicit kind, leaves a bare node blank", () => {
    class WsUrl extends Node.Tag<WsUrl>()("cd/ws", { url: "wss://x/rpc" }) {}
    class Port extends Node.Tag<Port>()("cd/port", 3001) {}
    class Explicit extends Node.Tag<Explicit>()("cd/explicit", {
      url: "/rpc",
      kind: "WebSocket",
    }) {}
    class Ipc extends Node.Tag<Ipc>()("cd/ipc", { path: "/tmp/cd.sock" }) {}
    class Bare extends Node.Tag<Bare>()("cd/bare") {}
    expect(WsUrl.kind).toBe("WebSocket");
    expect(Port.kind).toBe("Http");
    expect(Port.url).toBe("http://localhost:3001/rpc");
    expect(Explicit.kind).toBe("WebSocket");
    expect(Ipc.kind).toBe("IpcSocket");
    expect(Ipc.path).toBe("/tmp/cd.sock");
    expect(Ipc.url).toBeUndefined();
    expect(Bare.kind).toBeUndefined();
    expect(Bare.url).toBeUndefined();
    expect(Bare.path).toBeUndefined();
  });
});

// (The compile-time dispatch proof for all connect/connectHttp/connectSocket call styles lives in
// `resource-connect-dispatch.test.ts`. This file covers ProtocolKind inference and the wire round-trip.)

// ── end-to-end: node-derived clients round-trip over BOTH transports ──────────────────────────────
// One harness, two transports. The tag's bound node is wired with the pipeable node client (url
// overridden to the test port); `Hyperlink.client(tag)` resolves the bound node, so no ambient protocol
// is threaded by hand (the class of the HealthBoard's "connecting…" bug). Proves the derived-connect
// path streams live over a real ws server AND a real http server.
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class HubNode extends Node.Tag<HubNode>()("cd/hub") {}
class HubQueue extends QueueResource.Tag<HubQueue>()("cd/HubQueue", {
  payload: Item,
  node: HubNode,
}) {}

// The shared assertion: subscribe to status, enqueue, and confirm a completion delta crossed the wire.
const assertStreams = Effect.gen(function* () {
  const q = yield* HubQueue;
  const completed: number[] = [];
  yield* Stream.runForEach(q.status.changes, (s) =>
    Effect.sync(() => completed.push(s.completed)),
  ).pipe(Effect.forkScoped);
  yield* Effect.sleep("200 millis");
  yield* q.add({ n: 1 });
  yield* q.add({ n: 2 });
  yield* Effect.sleep("400 millis");
  expect(completed.at(-1)).toBeGreaterThan(0);
});

// Read the test-server port, wire the tag's bound node with the given pipeable client, run the
// assertion. Requires only `HttpServer` (to read the port) — each `it` provides its own server layer,
// so that layer's type is inferred inline rather than annotated.
const withPortClient = (connectAt: (port: number) => Layer.Layer<HubNode>) =>
  Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* assertStreams.pipe(
      Effect.provide(Hyperlink.client(HubQueue).pipe(Layer.provide(connectAt(port)))),
      Effect.scoped,
    );
  });

describe("node-derived clients stream live", () => {
  it.live("a node-derived socket client streams status live over ws", () =>
    withPortClient((port) =>
      HubNode.pipe(Node.connectSocket(`ws://127.0.0.1:${port}/rpc`)),
    ).pipe(
      Effect.provide(
        Node.wsServer([QueueResource.serveMemory(HubQueue, { effect: () => Effect.void })]).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
        ),
      ),
      Effect.scoped,
      Effect.timeout(Duration.seconds(10)),
    ),
  );

  it.live("a node-derived http client streams status live over http", () =>
    withPortClient((port) =>
      HubNode.pipe(Node.connectHttp(`http://127.0.0.1:${port}/rpc`)),
    ).pipe(
      Effect.provide(
        Node.httpServer([QueueResource.serveMemory(HubQueue, { effect: () => Effect.void })]).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
        ),
      ),
      Effect.scoped,
      Effect.timeout(Duration.seconds(10)),
    ),
  );
});
