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

describe("storage correctness — soft-default + AppStore override", () => {
  it.effect("Process.layer alone soft-defaults Memory (R fulfilled, no AppStore)", () =>
    Effect.gen(function* () {
      const live = Process.layer(Exec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      });
      yield* Effect.gen(function* () {
        yield* Exec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* Store.resolveOrDie(Exec.key, builtInProcessStoreContract(Exec));
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

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

  it.effect("sibling Layer.merge(Process.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-footgun-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "app.db");

      // Footgun: Soft never sees ambient Storage when AppStore is only a sibling merge.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Layer.merge(
            Process.layer(Exec, {
              effect: Effect.void,
              polling: Polling.spaced(Duration.millis(50)),
            }),
            AppStore.layer({ filename }),
          );
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
