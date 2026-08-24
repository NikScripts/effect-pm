import { Duration, Effect, Exit, Layer, Option, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as LookupPolicy from "../src/LookupPolicy";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";

/**
 * F5 split-dial (loud-failures §10): dashboard node status must use the runtime transport
 * override, never the tag's stamped server url. Resource clients and the HealthBoard die share
 * that override — proving both succeed together, and that a bare tag-url dial fails, locks the
 * invariant.
 */
const Item = Schema.Struct({ n: Schema.Number });

/** Override path — tag url dead; explicit connectSocket registers the live dial in the memo. */
class OverrideNode extends Node.Service<OverrideNode>()("ui/f5-override", {
  url: "http://127.0.0.1:1/rpc",
  kind: "WebSocket",
}) {}
class OverrideQ extends WorkPool.Service<OverrideQ>()("ui/F5OverrideQ", {
  payload: Item,
  node: OverrideNode,
}) {}

/** Bare-dial path — never receives an explicit override in this file (memo stays tag-url). */
class BareDeadNode extends Node.Service<BareDeadNode>()("ui/f5-bare-dead", {
  url: "http://127.0.0.1:1/rpc",
  kind: "WebSocket",
}) {}

const overrideServer = Node.wsServer([
  WorkPool.serveMemory(OverrideQ, { effect: () => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

describe("F5 split-dial: runtime transport override", () => {
  it.live("node status.changes over Node.connectSocket override (tag url stays dead)", () =>
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;
      const transport = OverrideNode.pipe(Node.connectSocket(`ws://127.0.0.1:${port}/rpc`));
      const head = yield* Stream.unwrap(Effect.map(OverrideNode, (h) => h.status.changes)).pipe(
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
    }).pipe(Effect.provide(overrideServer), Effect.scoped, Effect.timeout(Duration.seconds(10))),
  );

  it.live(
    "resource status + node status both succeed on the same override",
    () =>
      Effect.gen(function* () {
        const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = address._tag === "TcpAddress" ? address.port : 0;
        // Construct override *before* Hyperlink.client so connectAddressed reuses it (F5 memo).
        const transport = OverrideNode.pipe(Node.connectSocket(`ws://127.0.0.1:${port}/rpc`));
        // Verify still probes the tag's stamped url (:1) — opt out; this test is the dial target.
        const layer = Hyperlink.client(OverrideQ).pipe(
          LookupPolicy.provide(LookupPolicy.verifyOff),
          Layer.provideMerge(transport),
        );
        const [queueHead, nodeHead] = yield* Effect.all(
          [
            Stream.unwrap(Effect.map(OverrideQ, (q) => q.status.changes)).pipe(
              Stream.take(1),
              Stream.runHead,
            ),
            Stream.unwrap(Effect.map(OverrideNode, (h) => h.status.changes)).pipe(
              Stream.take(1),
              Stream.runHead,
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.provide(layer), Effect.timeout(Duration.seconds(5)));
        expect(Option.isSome(queueHead)).toBe(true);
        expect(Option.isSome(nodeHead)).toBe(true);
        if (Option.isSome(nodeHead)) {
          expect(nodeHead.value.services.some((r) => r.key === OverrideQ.key)).toBe(true);
        }
      }).pipe(Effect.provide(overrideServer), Effect.scoped, Effect.timeout(Duration.seconds(12))),
    { timeout: 15_000 },
  );

  it.live("bare Node.connect(tag) dials the dead stamped url and fails", () =>
    // No server needed — tag url :1 is dead. Separate Node class so override tests don't
    // poison the connect memo for this assertion.
    Stream.unwrap(Effect.map(BareDeadNode, (h) => h.status.changes)).pipe(
      Stream.take(1),
      Stream.runHead,
      Effect.provide(Node.connect(BareDeadNode)),
      Effect.timeout(Duration.seconds(2)),
      Effect.exit,
      Effect.map((exit) => {
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    ),
  );
});
