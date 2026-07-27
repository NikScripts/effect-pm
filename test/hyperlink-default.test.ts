import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as PmNode from "../src/Node";

class Counter extends Hyperlink.Tag<Counter>()("default-test/Counter", {
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  label: Hyperlink.default((n: number) => `count=${n}`),
  unit: Hyperlink.default("count" as const),
  admin: {
    banner: Hyperlink.default((name: string) => `hello ${name}`),
  },
}) {}

const impl = {
  current: Effect.succeed(7),
  add: (by: number) => Effect.succeed(by + 1),
  // defaults omitted from impl; default-only nest `admin` still appears as `{}`.
  admin: {},
};

it("default is Tag-baked — LOCAL (no impl slot)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Counter;
      expect(yield* c.current).toBe(7);
      expect(c.label(7)).toBe("count=7");
      expect(c.unit).toBe("count");
      expect(c.admin.banner("nik")).toBe("hello nik");
    }).pipe(Effect.provide(Hyperlink.layer(Counter, impl)), Effect.scoped),
  ));

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("default is identical REMOTE — same value, no wire round-trip", () =>
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
          expect(c.label(42)).toBe("count=42");
          expect(c.unit).toBe("count");
          expect(c.admin.banner("remote")).toBe("hello remote");
        }).pipe(
          Effect.provide(Hyperlink.client(Counter).pipe(Layer.provide(protocol(`${base}/rpc`)))),
          Effect.scoped,
        );
      }).pipe(Effect.provide(server), Effect.scoped);
    }),
  ));

const counterSpec = {
  current: Hyperlink.effect(Schema.Number),
};

class Adorned extends Hyperlink.Tag<Adorned>()(
  "default-test/Adorned",
  counterSpec,
).pipe(
  Hyperlink.defaults({
    label: (n: number) => `n=${n}`,
    tags: ["admin", "beta"] as const,
  }),
) {}

it("defaults pipe merges bag onto local service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const a = (yield* Adorned) as Hyperlink.WithDefaults<typeof Adorned>;
      expect(yield* a.current).toBe(1);
      expect(a.label(3)).toBe("n=3");
      expect(a.tags).toEqual(["admin", "beta"]);
    }).pipe(
      Effect.provide(Hyperlink.layer(Adorned, { current: Effect.succeed(1) })),
      Effect.scoped,
    ),
  ));

it("defaults key can be overridden in the layer impl (provide-site only)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const a = (yield* Adorned) as Hyperlink.WithDefaults<typeof Adorned>;
      expect(a.label(9)).toBe("over=9");
      expect(a.tags).toEqual(["admin", "beta"]);
    }).pipe(
      Effect.provide(
        Hyperlink.layer(Adorned, {
          current: Effect.succeed(1),
          label: (n: number) => `over=${n}`,
        }),
      ),
      Effect.scoped,
    ),
  ));

it("defaults pipe rejects Spec key collision", () => {
  const tag = Hyperlink.Tag()("default-test/Collide", {
    current: Hyperlink.effect(Schema.Number),
  });
  expect(() => Hyperlink.defaults(tag, { current: 1 })).toThrow(
    Hyperlink.DuplicateDefaultKey,
  );
});

it("defaults pipe rejects nested group prefix collision", () => {
  const tag = Hyperlink.Tag()("default-test/PrefixCollide", {
    admin: {
      banner: Hyperlink.default("x"),
    },
  });
  expect(() => Hyperlink.defaults(tag, { admin: 1 })).toThrow(
    Hyperlink.DuplicateDefaultKey,
  );
});

it("defaults empty bag is a no-op", () => {
  const tag = Hyperlink.Tag()("default-test/EmptyBag", {
    current: Hyperlink.effect(Schema.Number),
  }).pipe(Hyperlink.defaults({}));
  expect(tag[Hyperlink.defaultsSym]).toEqual({});
});

it("defaults double-pipe merges bags; duplicate key is loud", () => {
  const once = Hyperlink.Tag()("default-test/Double", {
    current: Hyperlink.effect(Schema.Number),
  }).pipe(Hyperlink.defaults({ a: 1 }));
  const twice = once.pipe(Hyperlink.defaults({ b: 2 }));
  expect(twice[Hyperlink.defaultsSym]).toEqual({ a: 1, b: 2 });
  expect(() => twice.pipe(Hyperlink.defaults({ a: 9 }))).toThrow(
    Hyperlink.DuplicateDefaultKey,
  );
});

class Mixed extends Hyperlink.Tag<Mixed>()("default-test/Mixed", {
  current: Hyperlink.effect(Schema.Number),
  unit: Hyperlink.default("count" as const),
}).pipe(Hyperlink.defaults({ label: (n: number) => `n=${n}` })) {}

it("Spec default + piped defaults coexist", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const m = (yield* Mixed) as Hyperlink.WithDefaults<typeof Mixed>;
      expect(yield* m.current).toBe(3);
      expect(m.unit).toBe("count");
      expect(m.label(3)).toBe("n=3");
    }).pipe(
      Effect.provide(Hyperlink.layer(Mixed, { current: Effect.succeed(3) })),
      Effect.scoped,
    ),
  ));

it("Spec default leaf can be overridden in the layer impl", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Counter;
      expect(c.label(1)).toBe("over=1");
      expect(c.admin.banner("x")).toBe("hi x");
    }).pipe(
      Effect.provide(
        Hyperlink.layer(Counter, {
          ...impl,
          label: (n: number) => `over=${n}`,
          admin: { banner: (name: string) => `hi ${name}` },
        }),
      ),
      Effect.scoped,
    ),
  ));

it("client still sees Tag-baked default when server layer overrode locally", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = PmNode.httpServer([
        Hyperlink.serve(Counter, {
          ...impl,
          label: (n: number) => `server-over=${n}`,
        }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;

        yield* Effect.gen(function* () {
          const c = yield* Counter;
          // Override is provide-site only — remote installs the Spec leaf.
          expect(c.label(1)).toBe("count=1");
        }).pipe(
          Effect.provide(Hyperlink.client(Counter).pipe(Layer.provide(protocol(`${base}/rpc`)))),
          Effect.scoped,
        );
      }).pipe(Effect.provide(server), Effect.scoped);
    }),
  ));

it("defaults bag is on the REMOTE client too", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = PmNode.httpServer([
        Hyperlink.serve(Adorned, { current: Effect.succeed(5) }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;

        yield* Effect.gen(function* () {
          const a = (yield* Adorned) as Hyperlink.WithDefaults<typeof Adorned>;
          expect(yield* a.current).toBe(5);
          expect(a.label(2)).toBe("n=2");
          expect(a.tags).toEqual(["admin", "beta"]);
        }).pipe(
          Effect.provide(Hyperlink.client(Adorned).pipe(Layer.provide(protocol(`${base}/rpc`)))),
          Effect.scoped,
        );
      }).pipe(Effect.provide(server), Effect.scoped);
    }),
  ));
