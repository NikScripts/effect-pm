/**
 * @module examples/forms/process-store/process-store-events-sqlite-layer
 *
 * ProcessStore generic events + SQLite RuntimeStorage.
 * Run: `npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts`
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Clock, Effect, FileSystem, Layer, Path } from "effect";
import {
  ProcessStore,
  ProcessStoreRunResource,
  RunResource,
  type AnalyticsEvent,
} from "../../../src";
import { layerProcessStore } from "../../../src/storage/sqlite";

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const processLifecycleTypes: ReadonlyArray<AnalyticsEvent["type"]> = [
  "process.lifecycle.changed",
];

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
    const store = yield* ProcessStore;
    const gate = yield* RunResource.make({
      name: "examples/SqliteBackedGate",
      effect: (n: number) => Effect.succeed(n + 1),
      concurrency: 1,
    });

    const occurredAt = yield* Clock.currentTimeMillis;
    yield* store.append({
      id: "manual-process-started",
      type: "process.lifecycle.changed",
      occurredAt,
      entityType: "process",
      entityId: "examples/ManualProcess",
      lifecycle: { tag: "Started" },
    });

    yield* gate(41);

    const runs = yield* ProcessStoreRunResource;
    const runtimeFacts = yield* runs.facts({
      resourceId: "examples/SqliteBackedGate",
      types: ["run-resource.run.started", "run-resource.run.completed"],
    });

    const processEvents = yield* store.events({
      entityType: "process",
      entityId: "examples/ManualProcess",
      types: processLifecycleTypes,
    });

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
