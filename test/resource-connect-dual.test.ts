import { Duration, Effect, Layer, Schema, Scope, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "vitest";
import { QueueResource } from "../src";
import type { QueueLayerConfig } from "../src/QueueResource";
import * as Resource from "../src/Resource";

// `Resource.connect` and its `connectHttp` / `connectSocket` shortcuts are dual (data-first + pipeable
// data-last) AND, in the node-only form, derive the transport from the node's declared `kind` — so the
// http↔socket mismatch that caused the dashboard's "no live data" bug can't be expressed. This proves
// the dispatch mechanics, the ProtocolKind stamping, and that a node-derived ws client round-trips.

describe("Node ProtocolKind inference", () => {
  it("infers socket from a ws url, http from a port, honors an explicit kind, leaves a bare node blank", () => {
    class WsUrl extends Resource.Node<WsUrl>("cd/ws", { url: "wss://x/rpc" }) {}
    class Port extends Resource.Node<Port>("cd/port", 3001) {}
    class Explicit extends Resource.Node<Explicit>("cd/explicit", { url: "/rpc", kind: "socket" }) {}
    class Bare extends Resource.Node<Bare>("cd/bare") {}
    expect(WsUrl.kind).toBe("socket");
    expect(Port.kind).toBe("http");
    expect(Port.url).toBe("http://localhost:3001/rpc");
    expect(Explicit.kind).toBe("socket");
    expect(Bare.kind).toBeUndefined();
    expect(Bare.url).toBeUndefined();
  });
});

// (The compile-time dispatch proof for all connect/connectHttp/connectSocket call styles lives in
// `resource-connect-dispatch.test.ts`. This file covers ProtocolKind inference and the wire round-trip.)

// ── end-to-end: a node-derived socket client round-trips over a real ws server ────────────────────
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class HubNode extends Resource.Node<HubNode>("cd/hub") {}
class HubQueue extends QueueResource.Tag<HubQueue>()("cd/HubQueue", {
  payload: Item,
  node: HubNode,
}) {}

const serveWs = (config: QueueLayerConfig<Item, void, never, never>) =>
  Resource.wsServer([QueueResource.serveMemory(HubQueue, config)]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

const withNodeClient = <A, E>(
  use: () => Effect.Effect<A, E, HubQueue | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    const port = address._tag === "TcpAddress" ? address.port : 0;
    // wire the tag's bound node with the pipeable socket client, url overridden to the test port.
    const clientLayer = Resource.client(HubQueue).pipe(
      Layer.provide(HubNode.pipe(Resource.connectSocket(`ws://127.0.0.1:${port}/rpc`))),
    );
    return yield* use().pipe(Effect.provide(clientLayer), Effect.scoped);
  }).pipe(Effect.provide(serveWs({ effect: () => Effect.void })), Effect.scoped);

it("a node-derived socket client streams status live over the wire", () =>
  Effect.runPromise(
    withNodeClient(() =>
      Effect.gen(function* () {
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
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  ));
