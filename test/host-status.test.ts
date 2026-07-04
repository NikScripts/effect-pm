import { Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as NodeStatus from "../src/NodeStatus";
import * as NodeLogs from "../src/NodeLogs";
import { buildNodeStatusImpl } from "../src/internal/nodeStatusResource";

// A node serving one ordinary resource over `httpServer` must ALSO auto-serve its node status
// (status / ping / logs / logHistory) without the author wiring anything — driven over real http.
class Echo extends Resource.Tag<Echo>()("nodeStatus/Echo", {
  ping: Resource.effect(Schema.String),
}) {}

const Server = Resource.httpServer([
  Resource.serve(Echo, { ping: Effect.succeed("pong") }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("every served node auto-serves its node status over http", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      yield* Effect.gen(function* () {
        const node = yield* NodeStatus.Tag;

        const snap = yield* node.statusNow;
        expect(snap.up).toBe(true);
        // the one user resource (Echo) — the node status itself is not counted
        expect(snap.resourceCount).toBe(1);
        expect(snap.uptimeMillis).toBeGreaterThanOrEqual(0);

        expect(typeof (yield* node.ping)).toBe("number");

        // the live status stream emits a first snapshot immediately
        const head = yield* Stream.runHead(node.status);
        expect(Option.isSome(head)).toBe(true);

        // no HistoryStore on the server → empty history (not an error)
        expect(yield* node.logHistory({ limit: 10 })).toEqual([]);
      }).pipe(
        Effect.provide(NodeStatus.clientHttp(`http://127.0.0.1:${port}/rpc`)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));

it("node status logs stream reflects the NodeLogs relay when provided", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const impl = buildNodeStatusImpl({ startedAt: 0, resourceCount: 0 });
      yield* Effect.logInfo("hello-node"); // captured by NodeLogs.layer's merged logger
      const head = yield* Stream.runHead(
        impl.logs.pipe(Stream.filter((e) => e.message.includes("hello-node"))),
      );
      expect(Option.isSome(head)).toBe(true);
    }).pipe(Effect.provide(NodeLogs.layer), Effect.scoped),
  ));
