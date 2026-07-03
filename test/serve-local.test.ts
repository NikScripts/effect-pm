import { Effect, Ref, Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `serveLocal` grants Self + LocalCapability AND mounts the wire handlers from ONE materialization — the
// co-located "serve it AND consume it here" case. The impl generator runs exactly ONCE (the wow report's
// "materialized twice" regression), and the in-process yield reads the same instance that's served.
class Svc extends Resource.Tag<Svc>()("serve-local/Svc", {
  handle: Resource.local<{ readonly id: number }>(),
  ping: Resource.effect(Schema.String),
}) {}

it("serveLocal materializes once and grants the local instance", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const builds = yield* Ref.make(0);
      const layer = Resource.serveLocal(
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
