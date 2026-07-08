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

class SqliteExec extends Process.Tag<SqliteExec>()("test/sqlite/Exec") {}

class SqliteStore extends Store.Service<SqliteStore>("@test/SqliteProcessStore")(
  Store.register(SqliteExec, builtInProcessStoreContract(SqliteExec)),
) {}

const clock = TestClock.layer();

describe("Process.layer — durable SQLite store", () => {
  it.effect("app Store.Service overrides default memory for engine writes", () =>
    Effect.gen(function* () {
      const live = Layer.provideMerge(
        SqliteStore.layerMemory,
        Process.layer(SqliteExec, {
          effect: Effect.void,
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* SqliteExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* SqliteStore.at(SqliteExec);
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(Layer.mergeAll(live, clock)), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("process store contract round-trips on SQLite across reconnects", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `effect-pm-process-store-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "process.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* SqliteStore.at(SqliteExec);
          yield* store.record({
            _tag: "Completed",
            processId: SqliteExec.key,
            scheduleKey: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            isStartupRun: true,
          });
        }).pipe(Effect.provide(SqliteStore.layer({ filename }))),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* SqliteStore.at(SqliteExec);
          const events = yield* store.events();
          expect(events).toHaveLength(1);
          expect(events[0]).toMatchObject({
            _tag: "Completed",
            processId: SqliteExec.key,
            isStartupRun: true,
          });
        }).pipe(Effect.provide(SqliteStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
