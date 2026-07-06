/**
 * @module examples/forms/process-store/process-store-events-sqlite-layer
 *
 * ProcessStorage facets + SQLite RuntimeStorage.
 * Run: `npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts`
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path } from "effect";
import { RunResource } from "../../../src";
import { ProcessLifecycleStore } from "../../../src/store/processLifecycle";
import { layerProcessStore } from "../../../src/storage/sqlite";

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

class SqliteDemoGate extends RunResource.Service<
  SqliteDemoGate,
  number,
  number,
  never
>()("examples/SqliteBackedGate", {
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

  const live = layerProcessStore({ filename: sqlitePath });

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

    yield* Effect.log(
      `run gate status: completed=${String(status.completed)}, inFlight=${String(status.inFlight)}`,
    );
    yield* Effect.log(
      `process lifecycle events: ${processEvents.map((event) => event.id).join(", ")}`,
    );
    yield* Effect.log(`sqlite-backed store path: ${sqlitePath}`);
  }).pipe(Effect.provide(Layer.mergeAll(live, SqliteDemoGate.layer)));
}).pipe(Effect.provide(platformLayer));

void Effect.runPromise(Effect.scoped(program));
