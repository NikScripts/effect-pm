import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Path, Schema, Stream } from "effect";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as Hyperlink from "../src/Hyperlink";
import * as Store from "../src/Store";

const readingSchema = Schema.Struct({ value: Schema.Number });

const thermometerContract = Store.contract({
  readings: Store.shape(readingSchema),
});

class ThermoStore extends Store.Service<ThermoStore>("@test/ThermoStore")(
  Store.register("thermo", thermometerContract),
) {}

const standaloneThermo = Store.scoped("solo", thermometerContract);

class RetentionStore extends Store.Service<RetentionStore>("@test/Retention")(
  Store.register("thermo", thermometerContract).pipe(Store.retention(2)),
) {}

describe("Store SQLite layer", () => {
  it.effect("persists rows across separate scoped connections", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `hyperlink-ts-store-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "store.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ThermoStore;
          yield* handle.readings.append({ value: 72 });
        }).pipe(Effect.provide(ThermoStore.layer({ filename }))),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ThermoStore;
          const rows = yield* handle.readings.read();
          expect(rows).toEqual([{ value: 72 }]);
        }).pipe(Effect.provide(ThermoStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("standalone store.layer({ filename }) reloads from disk", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `hyperlink-ts-store-solo-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "solo.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* standaloneThermo;
          yield* handle.readings.append({ value: 1 });
        }).pipe(Effect.provide(standaloneThermo.layer({ filename }))),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* standaloneThermo;
          expect(yield* handle.readings.read()).toEqual([{ value: 1 }]);
        }).pipe(Effect.provide(standaloneThermo.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("Store.changes emits append events", () =>
    Effect.gen(function* () {
      const handle = yield* ThermoStore;
      const events = yield* Store.changes("thermo");
      const fiber = yield* Effect.forkChild(
        events.pipe(Stream.take(2), Stream.runCollect),
      );
      yield* handle.readings.append({ value: 10 });
      yield* handle.readings.append({ value: 20 });
      const collected = yield* Fiber.join(fiber);
      expect([...collected].map((event) => event.method)).toEqual(["readings", "readings"]);
      expect([...collected].map((event) => event.payload)).toEqual([
        { value: 10 },
        { value: 20 },
      ]);
    }).pipe(Effect.provide(ThermoStore.layerMemory), Effect.scoped),
  );

  it.effect("retention trims oldest rows", () =>
    Effect.gen(function* () {
      const handle = yield* RetentionStore;
      yield* handle.readings.append({ value: 1 });
      yield* handle.readings.append({ value: 2 });
      yield* handle.readings.append({ value: 3 });
      const rows = yield* handle.readings.read();
      expect(rows).toEqual([{ value: 2 }, { value: 3 }]);
    }).pipe(Effect.provide(RetentionStore.layerMemory), Effect.scoped),
  );

  it.effect("Hyperlink.store tag attachment works with sqlite layer", () =>
    Effect.gen(function* () {
      class Sensor extends Hyperlink.Tag<Sensor>()("@test/Sensor", {
        value: Hyperlink.ref(Schema.Number),
      }).pipe(Hyperlink.withStore(thermometerContract)) {}

      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `hyperlink-ts-store-tag-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "tag.db");

      class AppStore extends Store.Service<AppStore>("@test/AppStore")(
        Store.scoped(Sensor, thermometerContract),
      ) {}

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Sensor.store;
          yield* handle.readings.append({ value: 99 });
        }).pipe(Effect.provide(AppStore.layer({ filename }))),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Sensor.store;
          expect(yield* handle.readings.read()).toEqual([{ value: 99 }]);
        }).pipe(Effect.provide(AppStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
