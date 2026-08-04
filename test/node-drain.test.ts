/**
 * `Node.drain` — status `phase: "draining"`, yield fail-closed, ping stays up.
 */
import { Effect, Layer, Schema } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpServer } from "effect/unstable/http";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import {
  NodeStatusTag,
  httpClient as nodeStatusHttpClient,
} from "../src/internal/nodeStatus";

class Jobs extends Hyperlink.Service<Jobs>()("drain/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const withPort = <A, E, R>(
  use: (port: number) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServer.HttpServer> =>
  Effect.gen(function* () {
    const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    return yield* use(addr._tag === "TcpAddress" ? addr.port : 0);
  });

describe("Node.drain", () => {
  it.effect("sets phase draining, keeps ping, yield refuses (incl. default accept)", () =>
    Effect.gen(function* () {
      const server = Node.httpServer(
        [Hyperlink.serve(Jobs, { ping: Effect.succeed("ok") })],
        { node: "drain/ready-node" },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* withPort((port) =>
        Effect.gen(function* () {
          const node = Node.Service()("drain/ready-node", {
            url: `http://127.0.0.1:${port}/rpc`,
            kind: "Http",
          });
          const statusLayer = nodeStatusHttpClient(
            `http://127.0.0.1:${port}/rpc`,
          );

          const before = yield* Effect.gen(function* () {
            const status = yield* NodeStatusTag;
            return yield* status.status.get;
          }).pipe(Effect.provide(statusLayer), Effect.scoped);
          expect(before.phase).toBe("running");

          yield* Node.drain(node);

          const after = yield* Effect.gen(function* () {
            const status = yield* NodeStatusTag;
            const snapshot = yield* status.status.get;
            const ping = yield* status.ping;
            const yielded = yield* status.yield;
            return { snapshot, ping, yielded };
          }).pipe(Effect.provide(statusLayer), Effect.scoped);

          expect(after.snapshot.phase).toBe("draining");
          expect(after.snapshot.up).toBe(true);
          expect(typeof after.ping).toBe("number");
          expect(after.yielded).toBe(false);

          // Idempotent
          yield* Node.drain(node);
          const again = yield* Effect.gen(function* () {
            const status = yield* NodeStatusTag;
            return yield* status.status.get;
          }).pipe(Effect.provide(statusLayer), Effect.scoped);
          expect(again.phase).toBe("draining");
        }),
      ).pipe(Effect.provide(server), Effect.scoped);
    }),
  );
});
