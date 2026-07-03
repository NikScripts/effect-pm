import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import { NodeLogs } from "../src";
import { LogAnnotationKeys } from "../src/LogContext";
import { layerProcessStore } from "../src/storage/sqlite/index";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("node log pipeline → SQLite", () => {
  it.live("capture → persistLayer(node) → LogStore (SQLite) → byNode / byResource", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      return path.join(directory, "logs.sqlite");
    }).pipe(
      Effect.flatMap((sqliteFilename) => {
        const node = "wnba";
        const env = NodeLogs.persistLayer(node).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              NodeLogs.layer,
              layerProcessStore({ filename: sqliteFilename }),
            ),
          ),
        );

        return Effect.gen(function* () {
          yield* Effect.annotateLogs(Effect.logInfo("sqlite pipeline tick"), {
            [LogAnnotationKeys.processId]: "billing/sync",
          });

          // the batched writer flushes on a ~250ms window — poll SQLite until the line lands
          yield* Effect.gen(function* () {
            while ((yield* NodeLogs.byNode(node)).length === 0) {
              yield* Effect.sleep(Duration.millis(20));
            }
          }).pipe(Effect.timeout(Duration.seconds(3)));

          const byNode = yield* NodeLogs.byNode(node, { limit: 10 });
          assert.strictEqual(byNode.length, 1);
          assert.strictEqual(byNode[0]?.message, "sqlite pipeline tick");

          const byResource = yield* NodeLogs.byResource({ processId: "billing/sync" });
          assert.strictEqual(byResource.length, 1);
          assert.strictEqual(byResource[0]?.message, "sqlite pipeline tick");
        }).pipe(Effect.provide(env), Effect.scoped);
      }),
      Effect.provide(nodePlatform),
    ),
  );
});
