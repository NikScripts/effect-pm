import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import { ProcessManagerLogRelay, relayWithCaptureLoggerLayer } from "../src/Logs";
import {
  ProcessGroupLogContext,
  ProcessManagerLogAnnotationKeys,
} from "../src/LogContext";
import { LogStore } from "../src/store/log";
import { layerProcessStore } from "../src/storage/sqlite/index";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("process manager log pipeline (H6)", () => {
  it.live("captureLoggerLayer → relayLayer → Log → SQLite load", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const sqliteFilename = path.join(directory, "logs.sqlite");
      const groupId = "pipeline-test-group";
      return { sqliteFilename, groupId };
    }).pipe(
      Effect.flatMap(({ sqliteFilename, groupId }) => {
        const childEnv = Layer.mergeAll(
          layerProcessStore({ filename: sqliteFilename }),
          Layer.succeed(ProcessGroupLogContext, { groupId }),
          relayWithCaptureLoggerLayer,
        );

        return Effect.gen(function* () {
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
          const log = yield* LogStore;
          const loaded = yield* log.load({
            groupId,
            limit: 10,
            sort: "desc",
          });
          assert.strictEqual(loaded.length, 1);
          assert.strictEqual(loaded[0]?.message, "relay pipeline tick");
        }).pipe(Effect.provide(childEnv), Effect.scoped);
      }),
      Effect.provide(nodePlatform),
    ),
  );
});
