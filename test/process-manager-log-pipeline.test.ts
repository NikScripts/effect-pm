import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import { captureLoggerLayer, relayLayer } from "../src/Logs.js";
import { ProcessManagerLogRelay } from "../src/processManagerLogRelay.js";
import {
  ProcessGroupLogContext,
  ProcessManagerLogAnnotationKeys,
} from "../src/processManagerLogContext.js";
import { ProcessStore } from "../src/ProcessStore.js";
import { layerProcessStore } from "../src/storage/sqlite/index.js";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("process manager log pipeline (H6)", () => {
  it.live("captureLoggerLayer → relayLayer → GroupLog → SQLite load", () => {
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const sqliteFilename = path.join(directory, "logs.sqlite");
      const groupId = "pipeline-test-group";

      const storeLayer = layerProcessStore({ filename: sqliteFilename });
      const storeAndLogContext = Layer.mergeAll(
        storeLayer,
        Layer.succeed(ProcessGroupLogContext, { groupId }),
      );
      const childEnv = storeAndLogContext.pipe(
        Layer.provideMerge(relayLayer),
        Layer.provideMerge(captureLoggerLayer),
      );

      yield* Effect.gen(function* () {
        yield* Effect.logInfo("relay pipeline tick").pipe(
          Effect.annotateLogs({
            [ProcessManagerLogAnnotationKeys.groupId]: groupId,
            [ProcessManagerLogAnnotationKeys.processId]: "billing/sync",
          }),
        );
        yield* Effect.yieldNow;
        const relay = yield* ProcessManagerLogRelay;
        const snap = yield* relay.snapshot;
        assert.strictEqual(snap.length, 1);
        assert.strictEqual(snap[0]?.message, "relay pipeline tick");
        yield* Effect.yieldNow;
        yield* Effect.sleep(Duration.millis(500));
        const store = yield* ProcessStore;
        const events = yield* store.events({
          types: ["group.log.entry"],
          entityType: "group",
          entityId: groupId,
        });
        assert.strictEqual(events.length, 1);
        const loaded = yield* store.GroupLog.load({
          groupId,
          limit: 10,
          sort: "desc",
        });
        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0]?.message, "relay pipeline tick");
      }).pipe(Effect.provide(childEnv), Effect.scoped);
    }).pipe(Effect.provide(nodePlatform));

    return program;
  });
});
