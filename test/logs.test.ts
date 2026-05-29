import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path } from "effect";
import { groupLogSqlitePath } from "../src/internal/manager/childLaunch";
import { LogStore } from "../src/store/log";
import { layerProcessStore } from "../src/storage/sqlite/index";
import { ProcessManagerLogAnnotationKeys } from "../src/LogContext";
import type { ProcessManagerLogEntry } from "../src/LogEntry";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("LogStore", () => {
  it.effect("record, load, and query via namespace and layerProcessStore", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const sqliteFilename = groupLogSqlitePath(directory, "workshop-group");
      yield* fs.makeDirectory(path.dirname(sqliteFilename), { recursive: true });
      const storeLayer = layerProcessStore({ filename: sqliteFilename });

      const entry: ProcessManagerLogEntry = {
        date: "2026-05-22T20:00:00.000Z",
        level: "Info",
        message: "sync tick",
        annotations: {
          [ProcessManagerLogAnnotationKeys.groupId]: "workshop-group",
          [ProcessManagerLogAnnotationKeys.processId]: "billing/sync",
        },
        spans: [],
      };

      yield* LogStore.record("workshop-group", "1", entry).pipe(
        Effect.provide(storeLayer),
        Effect.scoped,
      );

      const loaded = yield* Effect.gen(function* () {
        const log = yield* LogStore;
        return yield* log.load({
          groupId: "workshop-group",
          processId: "billing/sync",
          limit: 10,
          sort: "desc",
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped);

      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0]?.annotations[ProcessManagerLogAnnotationKeys.processId], "billing/sync");

      yield* Effect.gen(function* () {
        const log = yield* LogStore;
        yield* log.query({
          groupId: "workshop-group",
          processId: "billing/sync",
          limit: 10,
          sort: "desc",
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped, Effect.provide(nodePlatform));
    }).pipe(Effect.provide(nodePlatform)),
  );
});
