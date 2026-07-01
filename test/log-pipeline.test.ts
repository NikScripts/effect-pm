import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import { HostLogs } from "../src";
import { LogAnnotationKeys } from "../src/LogContext";
import { layerProcessStore } from "../src/storage/sqlite/index";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("host log pipeline → SQLite", () => {
  it.live("capture → persistLayer(host) → LogStore (SQLite) → byHost / byResource", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      return path.join(directory, "logs.sqlite");
    }).pipe(
      Effect.flatMap((sqliteFilename) => {
        const host = "wnba";
        const env = HostLogs.persistLayer(host).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              HostLogs.layer,
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
            while ((yield* HostLogs.byHost(host)).length === 0) {
              yield* Effect.sleep(Duration.millis(20));
            }
          }).pipe(Effect.timeout(Duration.seconds(3)));

          const byHost = yield* HostLogs.byHost(host, { limit: 10 });
          assert.strictEqual(byHost.length, 1);
          assert.strictEqual(byHost[0]?.message, "sqlite pipeline tick");

          const byResource = yield* HostLogs.byResource({ processId: "billing/sync" });
          assert.strictEqual(byResource.length, 1);
          assert.strictEqual(byResource[0]?.message, "sqlite pipeline tick");
        }).pipe(Effect.provide(env), Effect.scoped);
      }),
      Effect.provide(nodePlatform),
    ),
  );
});
