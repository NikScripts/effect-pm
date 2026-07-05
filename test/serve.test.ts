import { Effect, Layer, Ref, Schema } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `serve` grants Self + Local AND mounts the wire handlers from ONE materialization — the
// co-located "serve it AND consume it here" case. The impl generator runs exactly ONCE (the wow report's
// "materialized twice" regression), and the in-process yield reads the same instance that's served.
class Svc extends Resource.Tag<Svc>()("serve/Svc", {
  handle: Resource.local<{ readonly id: number }>(),
  ping: Resource.effect(Schema.String),
}) {}

it("serve materializes once and grants the local instance", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const builds = yield* Ref.make(0);
      const layer = Resource.serve(
        Svc,
        Effect.gen(function* () {
          yield* Ref.update(builds, (n) => n + 1); // count materializations
          return {
            handle: { id: 1 },
            ping: Effect.succeed("pong"),
          };
        }),
      );

      yield* Effect.gen(function* () {
        const svc = yield* Svc; // the local grant — served AND obtainable in-process
        expect(yield* svc.ping).toBe("pong");
        expect(yield* svc.handle).toEqual({ id: 1 }); // a Resource.local member (needs the capability)
        expect(yield* Ref.get(builds)).toBe(1); // ONE materialization, not two
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  ));

// The flip: httpServer grants each `serve` layer's LOCAL instance by default, from the same build that
// serves it — so a co-located node serves its resources AND `yield*`s them (one materialization).
class Db extends Resource.Tag<Db>()("serve-all/Db", {
  handle: Resource.local<{ readonly n: number }>(),
  ping: Resource.effect(Schema.String),
}) {}

it("httpServer grants each serve layer's local instance from one build", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const builds = yield* Ref.make(0);
      const node = Resource.httpServer([
        Resource.serve(
          Db,
          Effect.gen(function* () {
            yield* Ref.update(builds, (n) => n + 1);
            return { handle: { n: 7 }, ping: Effect.succeed("pong") };
          }),
        ),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* Effect.gen(function* () {
        const db = yield* Db; // local grant, straight from httpServer — no separate Resource.layer
        expect(yield* db.handle).toEqual({ n: 7 }); // a Resource.local member (needs the capability)
        expect(yield* db.ping).toBe("pong");
        expect(yield* Ref.get(builds)).toBe(1); // ONE materialization for both served + local
      }).pipe(Effect.provide(node), Effect.scoped);
    }),
  ));
