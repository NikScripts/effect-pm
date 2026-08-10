/**
 * Orchestrated Lookup A→B ownership handoff — same address; follow survives the gap.
 *
 * Mirrors `examples/node/lookup-follow-handoff.ts`: fork B bind-retry → release A → B binds.
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
    return `/tmp/hyperlink-ts-lookup-orch-${label}-${process.pid}-${now}.sock`;
  });

describe("Lookup follow ownership handoff (orchestrated)", () => {
  it.live(
    "fork B bind-retry → release A → follow RPCs land on B (cold registry)",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("main");
        const lookupNode = Node.Service()("lookup-orch/Lookup", { path }).pipe(
          Node.asLookup,
        );

        // A cleans the path on exit; B waits with unlink:false (no steal).
        const scopeA = yield* Scope.make();
        yield* Layer.build(
          Lookup.layerNode(lookupNode, { unlink: true }),
        ).pipe(Scope.provide(scopeA));

        const followCtx = yield* Layer.build(
          Lookup.follow(lookupNode).pipe(
            Policy.provide(Policy.StreamGap("stall")),
          ),
        );

        const id = Context.get(followCtx, Identity.Service);
        const claimKey = "lookup-orch/Mail";

        // Claim on A — proves live Identity; will be gone after cold replace.
        const won = yield* id
          .claim(
            new Lookup.ClaimRequest({
              key: claimKey,
              nodeKey: "lookup-orch/WorkerA",
              kind: "IpcSocket",
              path: "/tmp/lookup-orch-worker-a.sock",
            }),
          )
          .pipe(Effect.provide(followCtx));
        expect(won.nodeKey).toBe("lookup-orch/WorkerA");

        const resolvedOnA = yield* id
          .resolve(new Lookup.ResolveRequest({ key: claimKey }))
          .pipe(Effect.provide(followCtx));
        expect(Option.isSome(resolvedOnA)).toBe(true);

        // B bind-retry without unlink-steal — fails while A holds the path.
        const bFiber = yield* Layer.build(
          Lookup.layerNode(lookupNode, { unlink: false }),
        ).pipe(
          Effect.retry({
            schedule: Schedule.spaced(Duration.millis(50)),
          }),
          Effect.timeout(Duration.seconds(10)),
          Effect.forkScoped,
        );

        yield* Effect.sleep(Duration.millis(80));
        yield* Scope.close(scopeA, Exit.void);
        yield* Fiber.join(bFiber);

        // follow reinstalls; cold registry — prior claim is gone.
        const resolvedOnB = yield* id
          .resolve(new Lookup.ResolveRequest({ key: claimKey }))
          .pipe(
            Effect.provide(followCtx),
            Effect.retry({
              schedule: Schedule.spaced(Duration.millis(25)),
            }),
            Effect.timeout(Duration.seconds(10)),
          );
        expect(Option.isNone(resolvedOnB)).toBe(true);

        // Fresh claim on B works through the same follow facade.
        const wonB = yield* id
          .claim(
            new Lookup.ClaimRequest({
              key: claimKey,
              nodeKey: "lookup-orch/WorkerB",
              kind: "IpcSocket",
              path: "/tmp/lookup-orch-worker-b.sock",
            }),
          )
          .pipe(Effect.provide(followCtx));
        expect(wonB.nodeKey).toBe("lookup-orch/WorkerB");
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
    { timeout: 30_000 },
  );

  it.live(
    "in-flight resolve fiber survives orchestrated A→B",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("inflight");
        const lookupNode = Node.Service()("lookup-orch/LookupInflight", {
          path,
        }).pipe(Node.asLookup);

        const scopeA = yield* Scope.make();
        yield* Layer.build(
          Lookup.layerNode(lookupNode, { unlink: true }),
        ).pipe(Scope.provide(scopeA));

        const followCtx = yield* Layer.build(
          Lookup.follow(lookupNode).pipe(
            Policy.provide(Policy.StreamGap("stall")),
          ),
        );

        const id = Context.get(followCtx, Identity.Service);
        // Ignore transport gaps on the hammer — follow retries; fiber must not fail the suite.
        const hammer = yield* Effect.repeat(
          id
            .resolve(new Lookup.ResolveRequest({ key: "lookup-orch/hammer" }))
            .pipe(Effect.provide(followCtx), Effect.ignore),
          { schedule: Schedule.spaced(Duration.millis(20)) },
        ).pipe(Effect.forkScoped);

        yield* Effect.sleep(Duration.millis(60));

        const bFiber = yield* Layer.build(
          Lookup.layerNode(lookupNode, { unlink: false }),
        ).pipe(
          Effect.retry({
            schedule: Schedule.spaced(Duration.millis(50)),
          }),
          Effect.timeout(Duration.seconds(10)),
          Effect.forkScoped,
        );

        yield* Effect.sleep(Duration.millis(40));
        yield* Scope.close(scopeA, Exit.void);
        yield* Fiber.join(bFiber);

        yield* Effect.sleep(Duration.millis(300));
        yield* Fiber.interrupt(hammer);

        const after = yield* id
          .resolve(new Lookup.ResolveRequest({ key: "lookup-orch/hammer" }))
          .pipe(Effect.provide(followCtx));
        expect(Option.isNone(after)).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
    { timeout: 30_000 },
  );
});
