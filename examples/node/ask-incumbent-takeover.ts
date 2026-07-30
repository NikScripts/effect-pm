/**
 * @module examples/node/ask-incumbent-takeover
 *
 * **Same `nodeKey`, new dial** — `Policy.askIncumbent` + `Policy.yieldAccept` lets a
 * newcomer replace the Directory row. Contrast: `Policy.yieldRefuse` → `IncumbentAlive`.
 *
 * Not Launcher custody handoff — membership plane only.
 *
 * ```bash
 * pnpm run example:node-ask-incumbent-takeover
 * ```
 *
 * Guide: `docs/guides/policy.md` · `docs/guides/identity-coordinator.md`.
 * Suite: `test/lookup-directory.test.ts` (askIncumbent).
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
import * as Policy from "../../src/Policy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-ask-${label}-${String(now)}.sock`;
  });

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

class Jobs extends Hyperlink.Tag<Jobs>()("examples/ask-incumbent/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const pathA = yield* tmpSock("a");
  const pathB = yield* tmpSock("b");
  const pathHold = yield* tmpSock("hold");
  const pathRefuse = yield* tmpSock("refuse");

  const lookupNode = Node.Tag()("examples/ask-incumbent/Lookup", {
    path: lookupPath,
    onConflict: "askIncumbent",
  }).pipe(Node.asLookup);

  // Same wire key for A and B — Directory row identity.
  class Worker extends Node.Tag<Worker, Jobs>()(
    "examples/ask-incumbent/Worker",
    { path: pathA },
  ) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  yield* Effect.logInfo("1) Incumbent A — yieldAccept (default)");
  yield* Layer.build(
    Node.unix(Worker, [
      Hyperlink.serve(Jobs, { ping: Effect.succeed("from-a") }),
    ]).pipe(
      Policy.provide(Policy.yieldAccept),
      Layer.provide(lookupClient),
    ),
  );

  yield* waitUntil(
    Directory.nodesServing(Jobs).pipe(Effect.provide(lookupCtx)),
    (rows) => rows.length === 1 && rows[0]?.path === pathA,
  );

  yield* Effect.logInfo("2) Newcomer B same nodeKey — askIncumbent replaces row");
  class WorkerB extends Node.Tag<WorkerB, Jobs>()(
    "examples/ask-incumbent/Worker",
    { path: pathB },
  ) {}

  yield* Layer.build(
    Node.unix(WorkerB, [
      Hyperlink.serve(Jobs, { ping: Effect.succeed("from-b") }),
    ]).pipe(Layer.provide(lookupClient)),
  );

  const after = yield* waitUntil(
    Directory.nodesServing(Jobs).pipe(Effect.provide(lookupCtx)),
    (rows) => rows.length === 1 && rows[0]?.path === pathB,
  );
  yield* Effect.logInfo(`Directory dial → ${after[0]?.path ?? "?"}`);

  // Incumbent A may leave without wiping B (unregister is dial-matched).
  yield* Node.shutdown(Worker);

  const clientB = yield* Layer.build(
    Hyperlink.client(Jobs, WorkerB).pipe(
      Policy.provide(Policy.verifyOff),
      Layer.provide(lookupClient),
    ),
  );
  const pingB = yield* Effect.gen(function* () {
    const jobs = yield* Jobs;
    return yield* jobs.ping;
  }).pipe(Effect.provide(Context.merge(lookupCtx, clientB)));
  if (pingB !== "from-b") {
    return yield* Effect.die(new Error(`expected from-b, got ${pingB}`));
  }

  yield* Effect.logInfo("3) Contrast — yieldRefuse blocks a further steal");
  yield* Node.shutdown(WorkerB);

  yield* waitUntil(
    Directory.nodesServing(Jobs).pipe(Effect.provide(lookupCtx)),
    (rows) => rows.length === 0,
  );

  class WorkerHold extends Node.Tag<WorkerHold, Jobs>()(
    "examples/ask-incumbent/WorkerHold",
    { path: pathHold },
  ) {}

  yield* Layer.build(
    Node.unix(WorkerHold, [
      Hyperlink.serve(Jobs, { ping: Effect.succeed("hold") }),
    ]).pipe(
      Policy.provide(Policy.askIncumbent, Policy.yieldRefuse),
      Layer.provide(lookupClient),
    ),
  );

  const dir = Context.get(lookupCtx, Directory.Tag);
  const blocked = yield* dir
    .advertise(
      new Lookup.AdvertiseRequest({
        nodeKey: WorkerHold.key,
        kind: "IpcSocket",
        path: pathRefuse,
        serves: [Jobs.key],
        onConflict: "inherit",
      }),
    )
    .pipe(
      Effect.map(() => "ok" as const),
      Effect.catchTag("IncumbentAlive", () => Effect.succeed("alive" as const)),
      Effect.provide(lookupCtx),
    );

  if (blocked !== "alive") {
    return yield* Effect.die(new Error("expected IncumbentAlive under yieldRefuse"));
  }

  yield* Effect.logInfo("Done — askIncumbent accept vs refuse.");
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
