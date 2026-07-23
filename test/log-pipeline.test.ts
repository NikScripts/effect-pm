import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import * as Logs from "../src/Logs";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import { testBillingNodeKey, testSyncDaemonKey } from "./fixtures/logKeys";
import * as Node from "../src/Node";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

class BillingNode extends Node.Tag<BillingNode>()(testBillingNodeKey) {}
class SyncProc extends Daemon.Tag<SyncProc>()(testSyncDaemonKey) {}

class AppStore extends Store.Service<AppStore>("@test/log-pipeline/Store")(
  BillingNode.logs,
  Daemon.store(SyncProc),
) {}

describe("node log pipeline → SQLite", () => {
  it.live("capture → Node.logs / Daemon.store → byNode / byHyperlink", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const sqliteFilename = path.join(directory, "logs.sqlite");

      yield* Effect.gen(function* () {
        yield* Effect.logInfo("sqlite pipeline tick").pipe(Logs.withScope(SyncProc));

        yield* Effect.gen(function* () {
          while (
            (yield* Logs.byNode(BillingNode)).length === 0 ||
            (yield* Logs.byHyperlink(testSyncDaemonKey)).length === 0
          ) {
            yield* Effect.sleep(Duration.millis(20));
          }
        }).pipe(Effect.timeout(Duration.seconds(3)));

        const byNode = yield* Logs.byNode(BillingNode, { limit: 10 });
        assert.ok(byNode.some((row) => row.message === "sqlite pipeline tick"));

        const byHyperlink = yield* Logs.byHyperlink(testSyncDaemonKey);
        assert.ok(byHyperlink.some((row) => row.message === "sqlite pipeline tick"));
      }).pipe(Effect.provide(AppStore.layer({ filename: sqliteFilename })), Effect.scoped);
    }).pipe(Effect.provide(nodePlatform)),
  );
});
