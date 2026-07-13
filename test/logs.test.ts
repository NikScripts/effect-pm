import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path } from "effect";
import { LogStore } from "../src/store/log";
import { layerProcessStore } from "../src/storage/sqlite/index";
import { LogAnnotationKeys } from "../src/LogContext";
import type { LogEntry } from "../src/LogEntry";

import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("LogStore", () => {
  it.effect("record, load, and query via namespace and layerProcessStore", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const sqliteFilename = path.join(directory, "logs.sqlite");
      yield* fs.makeDirectory(path.dirname(sqliteFilename), { recursive: true });
      const storeLayer = layerProcessStore({ filename: sqliteFilename });

      const entry: LogEntry = {
        date: "2026-05-22T20:00:00.000Z",
        level: "Info",
        message: "sync tick",
        annotations: {
          [LogAnnotationKeys.node]: testBillingNodeKey,
          [LogAnnotationKeys.processId]: testSyncProcessKey,
        },
        spans: [],
      };

      yield* LogStore.record(testBillingNodeKey, "1", entry).pipe(
        Effect.provide(storeLayer),
        Effect.scoped,
      );

      const loaded = yield* Effect.gen(function* () {
        const log = yield* LogStore;
        return yield* log.load({
          groupId: testBillingNodeKey,
          processId: testSyncProcessKey,
          limit: 10,
          sort: "desc",
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped);

      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0]?.annotations[LogAnnotationKeys.processId], testSyncProcessKey);

      yield* Effect.gen(function* () {
        const log = yield* LogStore;
        yield* log.query({
          groupId: testBillingNodeKey,
          processId: testSyncProcessKey,
          limit: 10,
          sort: "desc",
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped, Effect.provide(nodePlatform));
    }).pipe(Effect.provide(nodePlatform)),
  );
});
