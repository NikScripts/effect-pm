import { Duration, Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";

/**
 * HealthBoard hung on "connecting…" when node status dialed the tag's stamped server url
 * (`http://127.0.0.1:…`) instead of the runtime's transport override (vite-proxied `"/rpc"`).
 *
 * `nodeStatusBundle` now reads `yield* node` from the Atom.runtime context only (no auto
 * `Node.connect` from the tag url). This test is the same stream shape: status over an
 * overridden dial target while the tag's own url stays dead.
 */
const Item = Schema.Struct({ n: Schema.Number });
class DeadUrlNode extends Node.Tag<DeadUrlNode>()("ui/dead-url", {
  url: "http://127.0.0.1:1/rpc",
  kind: "WebSocket",
}) {}
class DeadUrlQ extends WorkPool.Tag<DeadUrlQ>()("ui/DeadUrlQ", {
  payload: Item,
  node: DeadUrlNode,
}) {}

describe("node status uses runtime transport override", () => {
  it.live("status.changes over Node.connectSocket override, not the tag's dead url", () =>
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;
      const transport = DeadUrlNode.pipe(
        Node.connectSocket(`ws://127.0.0.1:${port}/rpc`),
      );
      // Same stream shape as `nodeStatusBundle` after the fix (runtime context, no tag-url dial).
      const head = yield* Stream.unwrap(Effect.map(DeadUrlNode, (h) => h.status.changes)).pipe(
        Stream.take(1),
        Stream.runHead,
        Effect.provide(transport),
        Effect.timeout(Duration.seconds(5)),
      );
      expect(Option.isSome(head)).toBe(true);
      if (Option.isSome(head)) {
        expect(head.value.up).toBe(true);
        expect(head.value.status).toBe("ok");
      }
    }).pipe(
      Effect.provide(
        Node.wsServer([
          WorkPool.serveMemory(DeadUrlQ, { effect: () => Effect.void }),
        ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
      ),
      Effect.scoped,
      Effect.timeout(Duration.seconds(10)),
    ),
  );
});
