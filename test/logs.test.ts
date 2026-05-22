import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as Logs from "../src/Logs.js";
import { ProcessManagerLogAnnotationKeys } from "../src/processManagerLogContext.js";
import type { ProcessManagerLogEntry } from "../src/processManagerLogEntry.js";
import { ProcessStore, isGroupLogEntryRecorded } from "../src/ProcessStore.js";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("Logs", () => {
  it.effect("record, load, and scopedQuery via SQLite layer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const sqlitePath = Logs.sqlitePath(directory, "workshop-group");
      yield* fs.makeDirectory(path.dirname(sqlitePath), { recursive: true });
      const storeLayer = Logs.layer(sqlitePath);

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

      yield* Logs.record("workshop-group", "1", entry).pipe(
        Effect.provide(storeLayer),
        Effect.scoped,
      );

      const loaded = yield* Effect.gen(function* () {
        const store = yield* ProcessStore;
        return yield* store.events({
          types: ["group.log.entry"],
          entityType: "group",
          entityId: "workshop-group",
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped);

      assert.strictEqual(loaded.length, 1);
      const row = loaded[0];
      assert.ok(row !== undefined && isGroupLogEntryRecorded(row));
      assert.strictEqual(row.log.entry.annotations[ProcessManagerLogAnnotationKeys.processId], "billing/sync");

      yield* Logs.scopedQuery(sqlitePath, {
        groupId: "workshop-group",
        processId: "billing/sync",
        limit: 10,
        sort: "desc",
      }).pipe(Effect.provide(nodePlatform));
    }).pipe(Effect.provide(nodePlatform)),
  );
});
