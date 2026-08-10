/**
 * @module examples/node/lookup-follow-handoff
 *
 * **Lookup A→B ownership handoff (same address)** — orchestrator sequences who binds
 * `lookup.sock`; dialers keep one {@link Lookup.follow} facade across the gap.
 *
 * Planes (do not collapse):
 * 1. **Dial** — `Lookup.follow` + `Policy.StreamGap` (survive A-down / B-up)
 * 2. **Registry** — v1 cold; claims / ads die with A; apps re-advertise on B
 * 3. **Orchestration** — start B (bind-retry) → release A → B binds same path
 *
 * Not WorkPool migration, not Launcher custody `Handle.handoff`, not dual Lookup addresses.
 *
 * ```bash
 * pnpm run example:node-lookup-follow-handoff
 * ```
 *
 * Guide: `docs/guides/policy.md` (`Lookup.follow`). Suite: `test/lookup-follow-handoff.test.ts`.
 * Docs page: `docs/examples/node/lookup-follow-handoff.md`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
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
import * as Lookup from "../../src/Lookup";
import * as Identity from "../../src/Identity";
import * as Policy from "../../src/Policy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-lookup-follow-${label}-${String(now)}.sock`;
  });

const program = Effect.gen(function* () {
  const path = yield* tmpSock("sock");
  // One address forever — A and B are successive owners, not two endpoints.
  const lookupNode = Node.Service()("examples/lookup-follow-handoff/Lookup", {
    path,
  }).pipe(Node.asLookup);

  yield* Effect.logInfo(`1) Lookup A binds ${path}`);
  const scopeA = yield* Scope.make();
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true })).pipe(
    Scope.provide(scopeA),
  );

  yield* Effect.logInfo(
    "2) Dialers: Lookup.follow (same path) + Policy.StreamGap — not Lookup.client",
  );
  const followCtx = yield* Layer.build(
    Lookup.follow(lookupNode).pipe(
      Policy.provide(Policy.streamGap("stall")),
    ),
  );

  const id = Context.get(followCtx, Identity.Service);
  const resolveProbe = id
    .resolve(
      new Lookup.ResolveRequest({
        key: "examples/lookup-follow-handoff/probe",
      }),
    )
    .pipe(Effect.provide(followCtx));

  const before = yield* resolveProbe;
  yield* Effect.logInfo(
    `3) Identity.resolve on A → ${Option.isNone(before) ? "none" : "some"} (ok)`,
  );

  // Orchestration: start B's bind-with-retry *before* A leaves (dream order).
  // B uses unlink:false so it never steals A's live sock — retry until A releases
  // (A was started with unlink:true, so close clears the path).
  yield* Effect.logInfo(
    "4) Orchestrator forks B bind-retry (same path, no unlink-steal), then releases A",
  );
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
  yield* Effect.logInfo("5) A released sock — B bind-retry should win");

  yield* Fiber.join(bFiber);
  yield* Effect.logInfo("6) Lookup B owns the same path");

  const after = yield* resolveProbe.pipe(
    Effect.retry({
      schedule: Schedule.spaced(Duration.millis(25)),
    }),
    Effect.timeout(Duration.seconds(10)),
  );
  yield* Effect.logInfo(
    `7) follow reinstalled — Identity.resolve on B → ${
      Option.isNone(after) ? "none" : "some"
    } (cold registry; prior claims died with A)`,
  );

  yield* Effect.logInfo(
    "Done — same-address Lookup ownership handoff. Next: Launcher ensure-Lookup-first.",
  );
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
