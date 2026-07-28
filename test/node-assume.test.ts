/**
 * `Node.assume` ownership ack — Ready-gated, single-use token, ownership mirror on status.
 */
import { Effect, Layer, Redacted, Schema } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpServer } from "effect/unstable/http";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import { NodeStatusTag, httpClient as nodeStatusHttpClient } from "../src/internal/nodeStatus";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

class Jobs extends Hyperlink.Tag<Jobs>()("assume/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

class Warming extends Hyperlink.Tag<Warming>()("assume/Warming", {
  ping: Hyperlink.effect(Schema.String),
}).pipe(
  Hyperlink.withReadiness(() => Effect.succeed({ ready: false, detail: "warming" })),
) {}

const withPort = <A, E, R>(
  use: (port: number) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServer.HttpServer> =>
  Effect.gen(function* () {
    const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    return yield* use(addr._tag === "TcpAddress" ? addr.port : 0);
  });

describe("Node.assume", () => {
  it.effect("acks ownership, mirrors status, rejects reuse / mismatch", () =>
    Effect.gen(function* () {
      const token = "track-a-assume-token-001";
      const server = Node.httpServer(
        [Hyperlink.serve(Jobs, { ping: Effect.succeed("ok") })],
        { assumeToken: token, node: "assume/ready-node" },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* withPort((port) =>
        Effect.gen(function* () {
          const node = Node.Tag()("assume/ready-node", {
            url: `http://127.0.0.1:${port}/rpc`,
            kind: "Http",
          });

          const before = yield* Effect.gen(function* () {
            const status = yield* NodeStatusTag;
            return yield* status.status.get;
          }).pipe(
            Effect.provide(nodeStatusHttpClient(`http://127.0.0.1:${port}/rpc`)),
            Effect.scoped,
          );
          expect(before.ownership).toBe("launcher");

          yield* Node.assume(node, { token });

          const after = yield* Effect.gen(function* () {
            const status = yield* NodeStatusTag;
            return yield* status.status.get;
          }).pipe(
            Effect.provide(nodeStatusHttpClient(`http://127.0.0.1:${port}/rpc`)),
            Effect.scoped,
          );
          expect(after.ownership).toBe("self");

          const reuse = yield* Effect.exit(Node.assume(node, { token }));
          const reuseErr = expectTaggedFailure(reuse, "AssumeTokenReused");
          expect(
            "node" in reuseErr && reuseErr.node === "assume/ready-node",
          ).toBe(true);

          const mismatch = yield* Effect.exit(
            Node.assume(node, { token: "wrong-token" }),
          );
          const mismatchErr = expectTaggedFailure(
            mismatch,
            "AssumeTokenMismatch",
          );
          expect(
            "node" in mismatchErr &&
              mismatchErr.node === "assume/ready-node",
          ).toBe(true);
        }),
      ).pipe(Effect.provide(server), Effect.scoped);
    }),
  );

  it.effect("rejects assume until Ready", () =>
    Effect.gen(function* () {
      const token = Redacted.make("track-a-assume-token-002");
      const server = Node.httpServer(
        [Hyperlink.serve(Warming, { ping: Effect.succeed("ok") })],
        { assumeToken: token, node: "assume/warming-node" },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* withPort((port) =>
        Effect.gen(function* () {
          const node = Node.Tag()("assume/warming-node", {
            url: `http://127.0.0.1:${port}/rpc`,
            kind: "Http",
          });
          const exit = yield* Effect.exit(
            Node.assume(node, { token: Redacted.value(token) }),
          );
          expectTaggedFailure(exit, "AssumeNotReady");
        }),
      ).pipe(Effect.provide(server), Effect.scoped);
    }),
  );

  it.effect("mismatch when no assumeToken configured", () =>
    Effect.gen(function* () {
      const server = Node.httpServer([
        Hyperlink.serve(Jobs, { ping: Effect.succeed("ok") }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* withPort((port) =>
        Effect.gen(function* () {
          const node = Node.Tag()("assume/no-token", {
            url: `http://127.0.0.1:${port}/rpc`,
            kind: "Http",
          });
          const snap = yield* Effect.gen(function* () {
            const status = yield* NodeStatusTag;
            return yield* status.status.get;
          }).pipe(
            Effect.provide(nodeStatusHttpClient(`http://127.0.0.1:${port}/rpc`)),
            Effect.scoped,
          );
          expect(snap.ownership).toBeUndefined();

          const exit = yield* Effect.exit(Node.assume(node, { token: "anything" }));
          expectTaggedFailure(exit, "AssumeTokenMismatch");
        }),
      ).pipe(Effect.provide(server), Effect.scoped);
    }),
  );
});
