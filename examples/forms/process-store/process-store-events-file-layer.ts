/**
 * @module examples/forms/process-store/process-store-events-file-layer
 *
 * ProcessStore generic events + file-backed storage.
 * Run: `npx tsx examples/forms/process-store/process-store-events-file-layer.ts`
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Clock, Effect, FileSystem, Layer, Path } from "effect";
import {
  ProcessStore,
  RunResource,
  RuntimeObserver,
  type AnalyticsEvent,
} from "../../../src";
import { provideLayer } from "../../../src/provideLayer";
import { fileLayer } from "../../../src/storage/file";

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const runtimeFactTypes: ReadonlyArray<AnalyticsEvent["type"]> = [
  "runtime.fact.recorded",
];

const processLifecycleTypes: ReadonlyArray<AnalyticsEvent["type"]> = [
  "process.lifecycle.changed",
];

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const filePath = path.join(
    ".tmp",
    "examples",
    "process-store-events.ndjson",
  );

  // Keep the demo deterministic while leaving the final NDJSON file inspectable.
  yield* fs.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const storeLayer = fileLayer(filePath);
  const observerLayer = Layer.provide(
    RuntimeObserver.layerProcessStore,
    storeLayer,
  );
  const live = Layer.mergeAll(storeLayer, observerLayer);

  yield* Effect.gen(function* () {
    const store = yield* ProcessStore;
    const gate = yield* RunResource.make({
      name: "examples/FileBackedGate",
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

    const runtimeFacts = yield* store.events({
      entityType: "run-resource",
      entityId: "examples/FileBackedGate",
      types: runtimeFactTypes,
    });

    const processEvents = yield* store.events({
      entityType: "process",
      entityId: "examples/ManualProcess",
      types: processLifecycleTypes,
    });

    yield* Effect.log(
      `runtime facts persisted: ${runtimeFacts.map((event) => event.id).join(", ")}`,
    );
    yield* Effect.log(
      `process lifecycle events: ${processEvents.map((event) => event.id).join(", ")}`,
    );

    // File storage is append-only NDJSON. Malformed rows are skipped on reads so
    // one bad line does not poison the whole local analytics file.
    yield* fs.writeFileString(filePath, "not json\n", { flag: "a" });
    const afterMalformedRow = yield* store.events();
    yield* Effect.log(
      `events after malformed row is skipped: ${String(afterMalformedRow.length)}`,
    );
    yield* Effect.log(`file-backed store path: ${filePath}`);
  }).pipe(provideLayer(live));
}).pipe(provideLayer(platformLayer));

void Effect.runPromise(program);
