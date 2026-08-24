/**
 * @module examples/node/drain-yield-refuse
 *
 * **`Node.drain`** — enter `phase: "draining"`, keep serving, refuse yield. An
 * `askIncumbent` newcomer gets `IncumbentAlive`; the Directory row stays on the
 * draining incumbent (draining ≠ dead).
 *
 * ```bash
 * pnpm run example:node-drain-yield-refuse
 * ```
 *
 * Guide: `docs/guides/identity-coordinator.md` · `docs/guides/policy.md`.
 * Suite: `test/node-drain.test.ts`, `test/lookup-directory.test.ts` (draining).
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
import * as LookupPolicy from "../../src/LookupPolicy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-drain-${label}-${String(now)}.sock`;
  });

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const step = (label: string) => Effect.logInfo(label);

class Jobs extends Hyperlink.Service<Jobs>()("examples/drain-yield/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const workerPath = yield* tmpSock("worker");
  const newcomerPath = yield* tmpSock("newcomer");

  const lookupNode = Node.Service()("examples/drain-yield/Lookup", {
    path: lookupPath,
    onConflict: "askIncumbent",
  }).pipe(Node.asLookup);

  class Worker extends Node.Service<Worker, Jobs>()(
    "examples/drain-yield/Worker",
    { path: workerPath },
  ) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  // Ambient askIncumbent — draining still refuses yield (Locked #31).
  yield* Layer.build(
    Node.unix(Worker, [
      Hyperlink.serve(Jobs, { ping: Effect.succeed("alive") }),
    ]).pipe(
      LookupPolicy.provide(LookupPolicy.askIncumbent, LookupPolicy.yieldAccept),
      Layer.provide(lookupClient),
    ),
  );

  const clientCtx = yield* Layer.build(
    Hyperlink.client(Jobs, Worker).pipe(
      LookupPolicy.provide(LookupPolicy.verifyOff),
      Layer.provide(lookupClient),
    ),
  );

  const ping = Effect.gen(function* () {
    const jobs = yield* Jobs;
    return yield* jobs.ping;
  }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));

  yield* step("1) Worker running — Jobs.ping");
  if ((yield* ping) !== "alive") {
    return yield* Effect.die(new Error("expected ping alive before drain"));
  }

  const nodeCtx = yield* Layer.build(
    Node.connect(Worker).pipe(LookupPolicy.provide(LookupPolicy.verifyOff)),
  );
  const before = yield* Effect.gen(function* () {
    const node = yield* Worker;
    return yield* node.status.get;
  }).pipe(Effect.provide(nodeCtx));
  if (before.phase !== "running") {
    return yield* Effect.die(new Error(`expected running, got ${before.phase}`));
  }

  yield* step("2) Node.drain — phase draining, Jobs still answers");
  yield* Node.drain(Worker);

  const after = yield* Effect.gen(function* () {
    const node = yield* Worker;
    return yield* node.status.get;
  }).pipe(Effect.provide(nodeCtx));
  if (after.phase !== "draining" || after.up !== true) {
    return yield* Effect.die(
      new Error(`expected draining+up, got phase=${after.phase} up=${String(after.up)}`),
    );
  }
  if ((yield* ping) !== "alive") {
    return yield* Effect.die(new Error("expected ping alive while draining"));
  }

  yield* step("3) askIncumbent newcomer → IncumbentAlive (row held)");
  const dir = Context.get(lookupCtx, Directory.Service);
  const conflict = yield* dir
    .advertise(
      new Lookup.AdvertiseRequest({
        nodeKey: Worker.key,
        kind: "IpcSocket",
        path: newcomerPath,
        serves: [Jobs.key],
        onConflict: "inherit",
      }),
    )
    .pipe(
      Effect.map((entry) => ({ _tag: "ok" as const, entry })),
      Effect.catchTag("IncumbentAlive", (error) =>
        Effect.succeed({ _tag: "alive" as const, error }),
      ),
      Effect.provide(lookupCtx),
    );

  if (conflict._tag !== "alive") {
    return yield* Effect.die(new Error("expected IncumbentAlive while draining"));
  }

  const rows = yield* waitUntil(
    Directory.nodesServing(Jobs).pipe(Effect.provide(lookupCtx)),
    (list) => list.length === 1,
  );
  if (rows[0]?.path !== workerPath) {
    return yield* Effect.die(
      new Error(`Directory row should stay on draining path, got ${rows[0]?.path}`),
    );
  }

  yield* Effect.logInfo("Done — drain keeps the row; yield refuses.");
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
