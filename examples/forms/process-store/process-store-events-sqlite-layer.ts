/**
 * @module examples/forms/process-store/process-store-events-sqlite-layer
 *
 * ProcessStorage facets + SQLite RuntimeStorage.
 * Run: `npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts`
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path } from "effect";
import {
  processStorageWithRunResourceArchiveLayer,
  RunResourceStore,
  RunResource,
} from "../../../src";
import { ProcessLifecycleScope } from "../../../src/ProcessLifecycleScope";
import { ProcessLifecycleStore } from "../../../src/store/processLifecycle";
import { layerProcessStore } from "../../../src/storage/sqlite";

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

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

  const live = Layer.provide(
    processStorageWithRunResourceArchiveLayer,
    layerProcessStore({ filename: sqlitePath }),
  );

  yield* Effect.gen(function* () {
    const gate = yield* RunResource.make({
      name: "examples/SqliteBackedGate",
      effect: (n: number) => Effect.succeed(n + 1),
      concurrency: 1,
    });

    yield* ProcessLifecycleScope.run(
      { processId: "examples/ManualProcess" },
      ProcessLifecycleStore.Lifecycle.Started,
    );

    yield* gate(41);

    const runs = yield* RunResourceStore;
    const runtimeFacts = yield* runs.facts({
      resourceId: "examples/SqliteBackedGate",
      types: ["RunResource.Run.Started", "RunResource.Run.Completed"],
    });

    const lifecycle = yield* ProcessLifecycleStore;
    const processEvents = yield* lifecycle.lifecycle("examples/ManualProcess");

    yield* Effect.log(
      `runtime facts persisted: ${runtimeFacts.map((fact) => `${fact.type}@${String(fact.occurredAt)}`).join(", ")}`,
    );
    yield* Effect.log(
      `process lifecycle events: ${processEvents.map((event) => event.id).join(", ")}`,
    );
    yield* Effect.log(`sqlite-backed store path: ${sqlitePath}`);
  }).pipe(Effect.provide(live), Effect.scoped);
}).pipe(Effect.provide(platformLayer));

void Effect.runPromise(program);
