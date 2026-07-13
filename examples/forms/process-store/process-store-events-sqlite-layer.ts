/**
 * @module examples/forms/process-store/process-store-events-sqlite-layer
 *
 * **Legacy facet plane** on SQLite — `layerProcessStore` + `ProcessLifecycleStore` lifecycle reads,
 * plus `RunResource.store` run facts. Execution history for processes uses **`Process.layer`** +
 * **`Process.store(tag)`** (see {@link ./process-layer-store-auto-write.ts}), not these facets.
 *
 * Run: `npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts`
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as RunResource from "../../../src/RunResource";
import * as Store from "../../../src/Store";
import { ProcessLifecycleStore } from "../../../src/store/processLifecycle";
import { layerProcessStore } from "../../../src/storage/sqlite";

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const gateKey = "examples/SqliteBackedGate";

class SqliteDemoGate extends RunResource.Service<SqliteDemoGate>()(gateKey, {
  payload: Schema.Number,
  success: Schema.Number,
  effect: (n: number) => Effect.succeed(n + 1),
  concurrency: 1,
}) {}

const runStoreRegistration = RunResource.store(SqliteDemoGate);

class SqliteRunStore extends Store.Service<SqliteRunStore>("@examples/SqliteRunStore")(
  runStoreRegistration,
) {}

const demoLayer = (sqlitePath: string) =>
  SqliteRunStore.layer({ filename: sqlitePath }).pipe(
    Layer.provideMerge(layerProcessStore({ filename: sqlitePath })),
    Layer.provideMerge(SqliteDemoGate.layer),
  );

const demoProgram = (sqlitePath: string) =>
  Effect.gen(function* () {
    yield* ProcessLifecycleStore.lifecycleChanged({
      processId: "examples/ManualProcess",
      tag: "Started",
    });

    yield* SqliteDemoGate.run(41);

    const gate = yield* SqliteDemoGate;
    const status = yield* gate.status.get;

    const lifecycle = yield* ProcessLifecycleStore;
    const processEvents = yield* lifecycle.lifecycle("examples/ManualProcess");

    const runStore = yield* SqliteRunStore;
    const facts = yield* runStore.facts();
    const stateHistory = yield* runStore.stateHistory();

    yield* Effect.log(
      `run gate status: completed=${String(status.completed)}, inFlight=${String(status.inFlight)}`,
    );
    yield* Effect.log(
      `run facts: ${facts.map((row) => row._tag).join(", ")}`,
    );
    yield* Effect.log(
      `run state transitions: ${stateHistory.map((row) => row.reason).join(", ")}`,
    );
    yield* Effect.log(
      `process lifecycle events: ${processEvents.map((event) => event.id).join(", ")}`,
    );
    yield* Effect.log(`sqlite-backed store path: ${sqlitePath}`);
  }).pipe(
    Effect.provide(demoLayer(sqlitePath)),
    Effect.scoped,
  ) as Effect.Effect<void, never, never>;

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

  yield* demoProgram(sqlitePath);
}).pipe(Effect.provide(platformLayer));

void Effect.runPromise(program);
