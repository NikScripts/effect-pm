import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import { TestClock } from "effect/testing";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { Polling } from "../src/Polling";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";

class Exec extends Process.Tag<Exec>()("test/storage-correctness/Exec") {}

class AppStore extends Store.Service<AppStore>("@test/storage-correctness/FileStore")(
  Store.register(Exec, builtInProcessStoreContract(Exec)),
) {}

const clock = TestClock.layer();

describe("storage correctness — AppStore SQLite capture", () => {
  it.effect("Process.layer + Layer.provideMerge(AppStore.sqlite) persists across reconnect", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "app.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Process.layer(Exec, {
            effect: Effect.void,
            polling: Polling.spaced(Duration.millis(50)),
          }).pipe(Layer.provideMerge(AppStore.layer({ filename })));
          yield* Effect.gen(function* () {
            yield* Exec;
            yield* TestClock.adjust(Duration.millis(200));
            const events = yield* (yield* AppStore).events();
            expect(events.some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(Layer.mergeAll(live, clock)));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* AppStore).events();
          expect(events.some((row) => row._tag === "Completed")).toBe(true);
        }).pipe(Effect.provide(AppStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, clock)), Effect.scoped),
  );

  it.effect("layerMemory alone never writes the AppStore SQLite file", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-footgun-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "app.db");

      // Footgun class: ephemeral toolkit Memory + private AppStore provide — SQLite stays empty.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Process.layerMemory(Exec, {
            effect: Effect.void,
            polling: Polling.spaced(Duration.millis(50)),
          }).pipe(Layer.provide(AppStore.layer({ filename })));
          yield* Effect.gen(function* () {
            yield* Exec;
            yield* TestClock.adjust(Duration.millis(200));
          }).pipe(Effect.provide(Layer.mergeAll(live, clock)));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* AppStore).events();
          expect(events.length).toBe(0);
        }).pipe(Effect.provide(AppStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, clock)), Effect.scoped),
  );
});
