/**
 * @module examples/node/handoff-ab-cutover
 *
 * **Live A→B cutover (Locked #39)** — WorkPool pending work moves from outgoing node A to
 * Directory peer B during `Node.shutdown` (baked `releaseEnqueueHandoff`).
 *
 * Crown-jewel recipe: start **B first** so Directory has a non-self dial; enqueue on A; shut A
 * down; pending lands on B. Peer pick excludes self **by dial**, not `nodeKey`.
 *
 * ```bash
 * pnpm run example:node-handoff-ab-cutover
 * ```
 *
 * Guide: `docs/guides/identity-coordinator.md` (A→B cutover). Suite: `test/handoff-ab-cutover.test.ts`.
 * Docs page: `docs/examples/node/handoff-ab-cutover.md`.
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
import * as Node from "../../src/Node";
import * as WorkPool from "../../src/WorkPool";

const Job = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
});

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-handoff-${label}-${String(now)}.sock`;
  });

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const nodesServing = (
  lookupCtx: Context.Context<Lookup.Directory>,
  serviceKey: string,
) =>
  Context.get(lookupCtx, Lookup.Directory)
    .nodesServing(new Lookup.NodesServingRequest({ serviceKey }))
    .pipe(Effect.provide(lookupCtx));

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const pathA = yield* tmpSock("a");
  const pathB = yield* tmpSock("b");

  const lookupNode = Node.Tag()("examples/handoff-ab/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);

  class Jobs extends WorkPool.Tag<Jobs>()("examples/handoff-ab/Jobs", {
    payload: Job,
  }) {}

  // Different nodeKeys so both Directory rows coexist; peer pick is by dial.
  class WorkerA extends Node.Tag<WorkerA, Jobs>()("examples/handoff-ab/WorkerA", {
    path: pathA,
  }) {}
  class WorkerB extends Node.Tag<WorkerB, Jobs>()("examples/handoff-ab/WorkerB", {
    path: pathB,
  }) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  yield* Effect.logInfo("1) Lookup up — start B first (Directory peer for A)");

  yield* Layer.build(
    Node.unix(WorkerB, [
      WorkPool.serve(Jobs, {
        effect: () => Effect.void,
        autoStart: false,
      }),
    ]).pipe(Layer.provide(lookupClient)),
  );

  const aCtx = yield* Layer.build(
    Node.unix(WorkerA, [
      WorkPool.serve(Jobs, {
        effect: () => Effect.void,
        autoStart: false,
      }),
    ]).pipe(Layer.provide(lookupClient)),
  );

  yield* waitUntil(
    nodesServing(lookupCtx, Jobs.key),
    (rows) => rows.length === 2,
  );

  const before = yield* nodesServing(lookupCtx, Jobs.key);
  yield* Effect.logInfo(
    `2) Directory has ${String(before.length)} row(s): ${before
      .map((r) => `${r.nodeKey}@${r.path ?? "?"}`)
      .join(", ")}`,
  );

  yield* Effect.gen(function* () {
    const q = yield* Jobs;
    yield* q.add([
      { id: "1", note: "invoice-a" },
      { id: "2", note: "invoice-b" },
      { id: "3", note: "invoice-c" },
    ]);
    const snap = yield* q.status.get;
    yield* Effect.logInfo(
      `3) Enqueued on A — pending normal=${String(snap.sizes.normal)}`,
    );
  }).pipe(Effect.provide(aCtx));

  yield* Effect.logInfo(
    "4) Node.shutdown(A) — drain → WorkPool.releaseEnqueueHandoff → leave",
  );
  yield* Node.shutdown(WorkerA);

  yield* waitUntil(
    nodesServing(lookupCtx, Jobs.key),
    (rows) =>
      rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
  );

  const after = yield* nodesServing(lookupCtx, Jobs.key);
  yield* Effect.logInfo(
    `5) A left — Directory now: ${after
      .map((r) => `${r.nodeKey}@${r.path ?? "?"}`)
      .join(", ")}`,
  );

  const bSnap = yield* Effect.gen(function* () {
    const q = yield* Jobs;
    return yield* q.status.get;
  }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);

  yield* Effect.logInfo(
    `6) Pending on B — normal=${String(bSnap.sizes.normal)} (transferred intact)`,
  );

  const released = yield* Effect.gen(function* () {
    const q = yield* Jobs;
    return yield* q.release({});
  }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);

  yield* Effect.logInfo(
    `7) Payloads on B: ${released.map((e) => e.item.note).join(", ")}`,
  );

  // B has no peer left — WorkPool bake would NoPeer-defer. Tear listen via scope end.
  yield* Effect.logInfo("Done — A→B handoff demo complete.");
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
