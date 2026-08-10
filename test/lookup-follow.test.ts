/**
 * Lookup.follow — same-sock A→B ownership replace; dialer survives the gap.
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schedule,
  Scope,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Lookup from "../src/Lookup";
import * as Identity from "../src/Identity";
import * as Policy from "../src/Policy";
import * as Node from "../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-lookup-follow-${label}-${process.pid}-${now}.sock`;
  });

describe("Lookup.follow", () => {
  it.live("static path: Identity works against live Lookup", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("static");
      const lookupNode = Node.Service()("lookup-follow/static", { path }).pipe(
        Node.asLookup,
      );

      yield* Layer.build(Lookup.layerNode(lookupNode));
      const followCtx = yield* Layer.build(
        Lookup.follow(lookupNode).pipe(
          Policy.provide(Policy.streamGap("stall")),
        ),
      );

      const id = Context.get(followCtx, Identity.Service);
      const resolved = yield* id
        .resolve(new Lookup.ResolveRequest({ key: "lookup-follow/none" }))
        .pipe(Effect.provide(followCtx));
      expect(Option.isNone(resolved)).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live("same-sock replace: RPCs succeed after A→B ownership move", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("replace");
      const lookupNode = Node.Service()("lookup-follow/replace", { path }).pipe(
        Node.asLookup,
      );

      // Scope A so we can close it without ending the outer test scope.
      const scopeA = yield* Scope.make();
      yield* Layer.build(Lookup.layerNode(lookupNode)).pipe(
        Scope.provide(scopeA),
      );

      const followCtx = yield* Layer.build(
        Lookup.follow(lookupNode).pipe(
          Policy.provide(Policy.streamGap("stall")),
        ),
      );

      const id = Context.get(followCtx, Identity.Service);
      const resolveNone = id
        .resolve(new Lookup.ResolveRequest({ key: "lookup-follow/probe" }))
        .pipe(Effect.provide(followCtx));

      expect(Option.isNone(yield* resolveNone)).toBe(true);

      // Release A (sock unbound), then B binds the same path.
      yield* Scope.close(scopeA, Exit.void);

      yield* Layer.build(
        Lookup.layerNode(lookupNode, { unlink: true }),
      );

      // Transparent retry across the gap — follow reinstalls until B answers.
      const after = yield* resolveNone.pipe(
        Effect.retry({
          schedule: Schedule.spaced(Duration.millis(25)),
        }),
        Effect.timeout(Duration.seconds(10)),
      );
      expect(Option.isNone(after)).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live(
    "transparent retry: in-flight resolve survives A-down / B-up on same path",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("retry");
        const lookupNode = Node.Service()("lookup-follow/retry", { path }).pipe(
          Node.asLookup,
        );

        const scopeA = yield* Scope.make();
        yield* Layer.build(Lookup.layerNode(lookupNode)).pipe(
          Scope.provide(scopeA),
        );

        const followCtx = yield* Layer.build(
          Lookup.follow(lookupNode).pipe(
            Policy.provide(Policy.streamGap("stall")),
          ),
        );

        const id = Context.get(followCtx, Identity.Service);
        const hammer = Effect.repeat(
          id
            .resolve(new Lookup.ResolveRequest({ key: "lookup-follow/hammer" }))
            .pipe(Effect.provide(followCtx)),
          { schedule: Schedule.spaced(Duration.millis(20)) },
        ).pipe(Effect.forkScoped);

        const fiber = yield* hammer;
        yield* Effect.sleep(Duration.millis(80));

        yield* Scope.close(scopeA, Exit.void);
        // Brief unbound gap, then B.
        yield* Effect.sleep(Duration.millis(50));
        yield* Layer.build(
          Lookup.layerNode(lookupNode, { unlink: true }),
        );

        // Let retries land on B, then stop the hammer.
        yield* Effect.sleep(Duration.millis(400));
        yield* Fiber.interrupt(fiber);

        const after = yield* id
          .resolve(new Lookup.ResolveRequest({ key: "lookup-follow/hammer" }))
          .pipe(Effect.provide(followCtx));
        expect(Option.isNone(after)).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );
});
