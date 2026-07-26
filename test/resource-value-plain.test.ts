import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as PmNode from "../src/Node";

// `value` fields are PLAIN values (no yield*), resolved once at acquire — identical local and remote.

class Cfg extends Hyperlink.Tag<Cfg>()("value-plain/Cfg", {
  maxSize: Hyperlink.value(Schema.Number),
  name: Hyperlink.value(Schema.String),
  current: Hyperlink.effect(Schema.Number),
}) {}

const impl = {
  maxSize: Effect.succeed(100),
  name: Effect.succeed("roster"),
  current: Effect.succeed(7),
};

it("value fields are plain, resolved once — LOCAL", () =>
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

it("value fields are plain, resolved once — REMOTE (same shape)", () =>
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

class Fallible extends Hyperlink.Tag<Fallible>()("value-plain/Fallible", {
  token: Hyperlink.value(Schema.String, Schema.String),
}) {}

it("fallible value fails LOCAL acquire (all-or-nothing)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          yield* Fallible;
        }).pipe(
          Effect.provide(
            Hyperlink.layer(Fallible, {
              token: Effect.fail("nope"),
            }),
          ),
          Effect.scoped,
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe("nope");
      }
    }),
  ));
