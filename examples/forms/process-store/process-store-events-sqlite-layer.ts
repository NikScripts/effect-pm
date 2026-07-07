/**
 * @module examples/forms/process-store/process-store-events-sqlite-layer
 *
 * ProcessStorage facets + SQLite RuntimeStorage, including RunResource run facts.
 * Run: `npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts`
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { RunResource } from "../../../src";
import { ProcessLifecycleStore } from "../../../src/store/processLifecycle";
import { RunResourceStore } from "../../../src/store/runResource";
import { layerProcessStore } from "../../../src/storage/sqlite";

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const gateKey = "examples/SqliteBackedGate";

class SqliteDemoGate extends RunResource.Service<SqliteDemoGate>()(gateKey, {
  inputSchema: Schema.Number,
  successSchema: Schema.Number,
  effect: (n: number) => Effect.succeed(n + 1),
  concurrency: 1,
}) {}

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const sqlitePath = path.join(
    ".tmp",
    "examples",
    "process-store-events.sqlite",
  );

  yield* fs.remove(sqlitePath).pipe(Effect.catch(() => Effect.void));
  yield* fs.makeDirectory(path.dirname(sqlitePath), { recursive: true }).pipe(Effect.orDie);

  const live = Layer.mergeAll(
    layerProcessStore({ filename: sqlitePath }),
    SqliteDemoGate.layer,
  );

  yield* Effect.gen(function* () {
    yield* ProcessLifecycleStore.lifecycleChanged({
      processId: "examples/ManualProcess",
      tag: "Started",
    });

    yield* SqliteDemoGate.run(41);

    const gate = yield* SqliteDemoGate;
    const status = yield* gate.status.get;

    const lifecycle = yield* ProcessLifecycleStore;
    const processEvents = yield* lifecycle.lifecycle("examples/ManualProcess");

    const runs = yield* RunResourceStore;
    const facts = yield* runs.facts({ resourceId: gateKey });
    const stateHistory = yield* runs.stateHistory({ resourceId: gateKey });

    yield* Effect.log(
      `run gate status: completed=${String(status.completed)}, inFlight=${String(status.inFlight)}`,
    );
    yield* Effect.log(
      `run facts: ${facts.map((row) => row.type).join(", ")}`,
    );
    yield* Effect.log(
      `run state transitions: ${stateHistory.map((row) => row.reason).join(", ")}`,
    );
    yield* Effect.log(
      `process lifecycle events: ${processEvents.map((event) => event.id).join(", ")}`,
    );
    yield* Effect.log(`sqlite-backed store path: ${sqlitePath}`);
  }).pipe(Effect.provide(live));
}).pipe(Effect.provide(platformLayer));

void Effect.runPromise(Effect.scoped(program));
