import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { TestClock } from "effect/testing";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import * as Polling from "../src/Polling";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class SqliteExec extends Daemon.Tag<SqliteExec>()("test/sqlite/Exec") {}

class SqliteTypedFailExec extends Daemon.Tag<SqliteTypedFailExec>()("test/sqlite/TypedFail", {
  error: FetchErr,
}) {}

class SqliteStore extends Store.Service<SqliteStore>("@test/SqliteDaemonStore")(
  Store.register(SqliteExec, builtInDaemonStoreContract(SqliteExec)),
  Store.register(SqliteTypedFailExec, builtInDaemonStoreContract(SqliteTypedFailExec)),
) {}

const clock = TestClock.layer();

describe("Daemon.layer — durable SQLite store", () => {
  it.effect("AppStore via Layer.provide — engine writes land on app memory store", () =>
    Effect.gen(function* () {
      const live = Daemon.layer(SqliteExec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      }).pipe(Layer.provideMerge(SqliteStore.layerMemory));
      yield* Effect.gen(function* () {
        yield* SqliteExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* SqliteStore.at(SqliteExec);
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(Layer.mergeAll(live, clock)), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("AppStore SQLite via Layer.provide — Daemon writes survive reconnect", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `hyperlink-ts-daemon-engine-sqlite-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "engine.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Daemon.layer(SqliteExec, {
            effect: Effect.void,
            polling: Polling.spaced(Duration.millis(50)),
          }).pipe(Layer.provideMerge(SqliteStore.layer({ filename })));
          yield* Effect.gen(function* () {
            yield* SqliteExec;
            yield* TestClock.adjust(Duration.millis(200));
            const events = yield* (yield* SqliteStore.at(SqliteExec)).events();
            expect(events.some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(Layer.mergeAll(live, clock)));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* SqliteStore.at(SqliteExec)).events();
          expect(events.some((row) => row._tag === "Completed")).toBe(true);
        }).pipe(Effect.provide(SqliteStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, clock)), Effect.scoped),
  );

  it.effect("daemon store contract round-trips on SQLite across reconnects", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `hyperlink-ts-daemon-store-${randomUUID()}`);
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
            key: SqliteExec.key,
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
            key: SqliteExec.key,
            isStartupRun: true,
          });
        }).pipe(Effect.provide(SqliteStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("typed Failed.error round-trips through SQLite journal codec", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `hyperlink-ts-daemon-typed-fail-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "typed-fail.db");
      const fail = yield* Schema.decodeUnknownEffect(FetchErr)({
        _tag: "FetchError",
        status: 418,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* SqliteStore.at(SqliteTypedFailExec);
          yield* store.record({
            _tag: "Failed",
            key: SqliteTypedFailExec.key,
            scheduleKey: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            isStartupRun: true,
            error: fail,
          });
        }).pipe(Effect.provide(SqliteStore.layer({ filename }))),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* SqliteStore.at(SqliteTypedFailExec);
          const events = yield* store.events();
          const failed = events.find((row) => row._tag === "Failed");
          expect(failed).toMatchObject({
            error: { _tag: "FetchError", status: 418 },
          });
        }).pipe(Effect.provide(SqliteStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
