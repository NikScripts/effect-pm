import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as PmNode from "../src/Node";

// `constant` fields are PLAIN values (no yield*), resolved once at acquire — identical local and remote.

class Cfg extends Hyperlink.Tag<Cfg>()("const-test/Cfg", {
  maxSize: Hyperlink.constant(Schema.Number),
  name: Hyperlink.constant(Schema.String),
  current: Hyperlink.effect(Schema.Number),
}) {}

const impl = {
  maxSize: Effect.succeed(100),
  name: Effect.succeed("roster"),
  current: Effect.succeed(7),
};

it("constant fields are plain, resolved once — LOCAL", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Cfg;
      expect(c.maxSize).toBe(100); // plain number, no yield*
      expect(c.name).toBe("roster"); // plain string
      expect(yield* c.current).toBe(7); // effect field still yields
    }).pipe(Effect.provide(Hyperlink.layer(Cfg, impl)), Effect.scoped),
  ));

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const Node = PmNode.httpServer([Hyperlink.serve(Cfg, impl)]).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
);

it("constant fields are plain, resolved once — REMOTE (same shape)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      yield* Effect.gen(function* () {
        const c = yield* Cfg;
        expect(c.maxSize).toBe(100); // plain — resolved at acquire over the wire
        expect(c.name).toBe("roster");
        expect(yield* c.current).toBe(7);
      }).pipe(
        Effect.provide(Hyperlink.client(Cfg).pipe(Layer.provide(protocol(`${base}/rpc`)))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Node), Effect.scoped),
  ));
