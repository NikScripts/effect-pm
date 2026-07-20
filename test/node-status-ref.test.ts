import { Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as NodeStatus from "../src/NodeStatus";
import { buildNodeStatusImpl } from "../src/internal/nodeStatusResource";
import * as Node from "../src/Node";

class Echo extends Resource.Tag<Echo>()("nodeStatus-ref/Echo", {
  ping: Resource.effect(Schema.String),
}) {}

const Server = Node.httpServer([
  Resource.serve(Echo, { ping: Effect.succeed("pong") }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("NodeStatus exposes status as Subscribable and nested logs over http", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      yield* Effect.gen(function* () {
        const node = yield* NodeStatus.Tag;
        expect("get" in node.status).toBe(true);
        expect("changes" in node.status).toBe(true);
        expect("statusNow" in node).toBe(false);
        expect(node.logs.stream).toBeDefined();
        expect(node.logs.query).toBeDefined();
        expect("logHistory" in node).toBe(false);

        const snap = yield* node.status.get;
        expect(snap.up).toBe(true);
        expect(snap.resourceCount).toBe(1);

        const head = yield* Stream.runHead(node.status.changes);
        expect(Option.isSome(head)).toBe(true);
        expect(yield* node.logs.query({ limit: 10 })).toEqual([]);
      }).pipe(
        Effect.provide(NodeStatus.clientHttp(`http://127.0.0.1:${port}/rpc`)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));

it("buildNodeStatusImpl status ref shape matches the contract", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const impl = buildNodeStatusImpl({ startedAt: 0, resourceCount: 2 });
      const snap = yield* impl.status.get;
      expect(snap.resourceCount).toBe(2);
      const head = yield* Stream.runHead(Stream.take(impl.status.changes, 1));
      expect(Option.isSome(head)).toBe(true);
    }),
  ));
