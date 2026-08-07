/**
 * @module examples/node/policy-lookup-cutover
 *
 * **Policy + lookupClient cutover** — warm sticky dual-serve, Advice prefer early-move,
 * typed `Policy.make({ … })` via `Policy.provide`. Dialers keep one `lookupClient`
 * facade across A→B.
 *
 * ```bash
 * pnpm run example:node-policy-lookup-cutover
 * ```
 *
 * Guide: `docs/guides/policy.md`. Suite: `test/policy-lookup-client.test.ts`.
 * Docs page: `docs/examples/node/policy-lookup-cutover.md`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
} from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Directory from "../../src/Directory";
import * as Advice from "../../src/Advice";
import * as Policy from "../../src/Policy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-policy-${label}-${String(now)}.sock`;
  });

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const step = (label: string, actual: number, expected: number) =>
  Effect.gen(function* () {
    if (actual !== expected) {
      return yield* Effect.die(
        new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`),
      );
    }
    yield* Effect.logInfo(`${label} → ${String(actual)}`);
  });

class Jobs extends Hyperlink.Tag<Jobs>()("examples/policy-cutover/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const pathA = yield* tmpSock("a");
  const pathB = yield* tmpSock("b");

  const lookupNode = Node.Tag()("examples/policy-cutover/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);

  class WorkerA extends Node.Tag<WorkerA, Jobs>()(
    "examples/policy-cutover/WorkerA",
    { path: pathA },
  ) {}
  class WorkerB extends Node.Tag<WorkerB, Jobs>()(
    "examples/policy-cutover/WorkerB",
    { path: pathB },
  ) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  yield* Effect.logInfo("1) Lookup up — start A, dial with Policy cutover bundle");

  yield* Layer.build(
    Node.unix(WorkerA, [
      Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
    ]).pipe(Layer.provide(lookupClient)),
  );

  // Typed Policy — pipe layer to expand config (also Policy.layer(a, b, c)).
  const cutover = Policy.make({ Sticky: true, ColdAmbiguous: "fail" }).pipe(
    Policy.layer(Policy.streamGap("stall")),
    Policy.layer(Policy.verifyReject),
  );
  const clientCtx = yield* Layer.build(
    Hyperlink.lookupClient(Jobs).pipe(
      Policy.provide(cutover),
      Layer.provide(lookupClient),
    ),
  );

  const readJobs = Effect.gen(function* () {
    const jobs = yield* Jobs;
    return yield* jobs.jobs;
  }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));

  yield* step("2) lookupClient dials A", yield* readJobs, 5);

  yield* Effect.logInfo("3) Start B — dual-serve window (no Advice yet)");
  yield* Layer.build(
    Node.unix(WorkerB, [
      Hyperlink.serve(Jobs, { jobs: Effect.succeed(9) }),
    ]).pipe(Layer.provide(lookupClient)),
  );

  yield* waitUntil(
    Directory.nodesServing(Jobs).pipe(Effect.provide(lookupCtx)),
    (rows) => rows.length === 2,
  );

  // Warm sticky: stay on A while both are Directory-visible and Advice is clear.
  yield* Effect.sleep(Duration.millis(80));
  yield* step("4) Still on A (Policy.sticky)", yield* readJobs, 5);

  yield* Effect.logInfo("5) Advice.prefer(B) — early move before A leaves");
  yield* Advice.prefer(Jobs, WorkerB.key).pipe(Effect.provide(lookupCtx));

  yield* waitUntil(readJobs, (n) => n === 9);
  yield* step("6) Same lookupClient facade now dials B", yield* readJobs, 9);

  yield* Node.shutdown(WorkerA);
  yield* waitUntil(
    Directory.nodesServing(Jobs).pipe(Effect.provide(lookupCtx)),
    (rows) => rows.length === 1,
  );
  yield* step("7) A gone — still on B", yield* readJobs, 9);

  yield* Effect.logInfo("Done — Policy lookup cutover demo complete.");
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
