import { Effect, Layer, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import { specOf } from "../src/Resource";

// A **nested** spec: top-level leaves alongside groups of leaves — an `effect`, a `stream`, and a
// payload `effectFn` living under `connections` / `admin`. Proves the spec-tree flattens on the wire and
// nests back in the service (the same `yield* Tag` code, local or remote).
class Server extends Resource.Tag<Server>()("nest-test/Server", {
  name: Resource.effect(Schema.String),
  connections: {
    size: Resource.effect(Schema.Number),
    total: Resource.effect(Schema.Number),
    changes: Resource.stream(Schema.Number),
  },
  admin: {
    ban: Resource.effectFn(Schema.Boolean, {
      payload: Schema.Struct({ user: Schema.String }),
    }),
  },
}) {}

const impl = {
  name: Effect.succeed("srv-1"),
  connections: {
    size: Effect.succeed(3),
    total: Effect.succeed(100),
    changes: Stream.make(1, 2, 3),
  },
  admin: {
    ban: ({ user }: { readonly user: string }) => Effect.succeed(user === "bad"),
  },
};

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

// the group's RPCs are path-keyed across nesting — the flat wire contract.
it("nested spec flattens to path-keyed wire procedures", () => {
  const flat = Object.keys(specOf(Server) as Record<string, unknown>).sort();
  expect(flat).toEqual([
    "admin.ban",
    "connections.changes",
    "connections.size",
    "connections.total",
    "name",
  ]);
});

it("nested spec — LOCAL: groups resolve; nested stream + payload fn work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const p = yield* Server;
      expect(yield* p.name).toBe("srv-1");
      // nested group leaves
      expect(yield* p.connections.size).toBe(3);
      expect(yield* p.connections.total).toBe(100);
      // nested payload fn
      expect(yield* p.admin.ban({ user: "bad" })).toBe(true);
      expect(yield* p.admin.ban({ user: "ok" })).toBe(false);
      // nested stream
      const seen = yield* Stream.runCollect(p.connections.changes);
      expect(Array.from(seen)).toEqual([1, 2, 3]);
    }).pipe(Effect.provide(Resource.layer(Server, impl)), Effect.scoped),
  ));

it("nested spec — REMOTE over http: same nested access across the wire", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const Node = Resource.httpServer([Resource.serve(Server, impl)]).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;

        yield* Effect.gen(function* () {
          const p = yield* Server;
          expect(yield* p.name).toBe("srv-1");
          expect(yield* p.connections.size).toBe(3);
          expect(yield* p.connections.total).toBe(100);
          expect(yield* p.admin.ban({ user: "bad" })).toBe(true);
          expect(yield* p.admin.ban({ user: "ok" })).toBe(false);
          const seen = yield* Stream.runCollect(p.connections.changes);
          expect(Array.from(seen)).toEqual([1, 2, 3]);
        }).pipe(
          Effect.provide(
            Resource.client(Server).pipe(Layer.provide(protocol(`${base}/rpc`))),
          ),
          Effect.scoped,
        );
      }).pipe(Effect.provide(Node), Effect.scoped);
    }),
  ));
