import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

class BillingNode extends Resource.Node<BillingNode>(testBillingNodeKey) {}
class SyncProc extends Process.Tag<SyncProc>()(testSyncProcessKey) {}

class AppStore extends Store.Service<AppStore>("@test/log-pipeline/Store")(
  BillingNode.logs,
  Process.store(SyncProc),
) {}

describe("node log pipeline → SQLite", () => {
  it.live("capture → Node.logs / Process.store → byNode / byResource", () =>
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
            (yield* Logs.byResource(testSyncProcessKey)).length === 0
          ) {
            yield* Effect.sleep(Duration.millis(20));
          }
        }).pipe(Effect.timeout(Duration.seconds(3)));

        const byNode = yield* Logs.byNode(BillingNode, { limit: 10 });
        assert.ok(byNode.some((row) => row.message === "sqlite pipeline tick"));

        const byResource = yield* Logs.byResource(testSyncProcessKey);
        assert.ok(byResource.some((row) => row.message === "sqlite pipeline tick"));
      }).pipe(Effect.provide(AppStore.layer({ filename: sqliteFilename })), Effect.scoped);
    }).pipe(Effect.provide(nodePlatform)),
  );
});
