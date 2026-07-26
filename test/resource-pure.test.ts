import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as PmNode from "../src/Node";

class Counter extends Hyperlink.Tag<Counter>()("pure-test/Counter", {
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  label: Hyperlink.pure((n: number) => `count=${n}`),
  admin: {
    banner: Hyperlink.pure((name: string) => `hello ${name}`),
  },
}) {}

const impl = {
  current: Effect.succeed(7),
  add: (by: number) => Effect.succeed(by + 1),
  // label is Tag-baked (omitted). Pure-only nest `admin` still appears as `{}`.
  admin: {},
};

it("pure fn is Tag-baked — LOCAL (no impl slot)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Counter;
      expect(yield* c.current).toBe(7);
      expect(c.label(7)).toBe("count=7");
      expect(c.admin.banner("nik")).toBe("hello nik");
    }).pipe(Effect.provide(Hyperlink.layer(Counter, impl)), Effect.scoped),
  ));

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("pure fn is identical REMOTE — same fn, no wire round-trip", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = PmNode.httpServer([Hyperlink.serve(Counter, impl)]).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;

        yield* Effect.gen(function* () {
          const c = yield* Counter;
          expect(yield* c.add(41)).toBe(42);
          // same Tag-baked fn as local — not fetched over RPC
          expect(c.label(42)).toBe("count=42");
          expect(c.admin.banner("remote")).toBe("hello remote");
        }).pipe(
          Effect.provide(Hyperlink.client(Counter).pipe(Layer.provide(protocol(`${base}/rpc`)))),
          Effect.scoped,
        );
      }).pipe(Effect.provide(server), Effect.scoped);
    }),
  ));
