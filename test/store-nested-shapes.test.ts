import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import * as Store from "../src/Store";

// A nested shape tree: `sensors.temperature` / `sensors.humidity` plus a flat `alerts` leaf. Part 2
// custom methods alias the DEFAULT effects reached through the tree (proves nested alias identity).

const temperatureRow = Schema.Struct({ celsius: Schema.Number });
const humidityRow = Schema.Struct({ percent: Schema.Number });
const alertRow = Schema.Struct({ message: Schema.String });

const sensorContract = Store.contract(
  {
    sensors: {
      temperature: temperatureRow,
      humidity: humidityRow,
    },
    alerts: alertRow,
  },
  ({ sensors, alerts }) => ({
    recordTemp: sensors.temperature.append,
    latestTemp: sensors.temperature.read,
    recordHumidity: sensors.humidity.append,
    latestHumidity: sensors.humidity.read,
    recordAlert: alerts.append,
  }),
);

const SensorStore = Store.scoped("sensors", sensorContract);

describe("nested store shapes", () => {
  it.effect("resolved handle exposes nested shapes: handle.sensors.temperature.append/read", () =>
    Effect.gen(function* () {
      const handle = yield* SensorStore;

      // The PRIMARY API — append/read on the nested resolved handle, not just top-level aliases.
      yield* handle.sensors.temperature.append({ celsius: 21 });
      yield* handle.sensors.temperature.append({ celsius: 25 });
      yield* handle.sensors.humidity.append({ percent: 40 });
      yield* handle.alerts.append({ message: "hot" });

      expect(yield* handle.sensors.temperature.read()).toEqual([{ celsius: 21 }, { celsius: 25 }]);
      expect(yield* handle.sensors.humidity.read()).toEqual([{ percent: 40 }]);
      // Flat leaf still lives at the top level.
      expect(yield* handle.alerts.read()).toEqual([{ message: "hot" }]);
    }).pipe(Effect.provide(SensorStore.layerMemory), Effect.scoped),
  );

  it.effect("nested default effects and their top-level aliases share the same rows", () =>
    Effect.gen(function* () {
      const handle = yield* SensorStore;

      yield* handle.recordTemp({ celsius: 21 });
      yield* handle.recordHumidity({ percent: 40 });

      // Alias reads see the same rows the nested namespace wrote (append via alias, read via nested).
      expect(yield* handle.latestTemp()).toEqual([{ celsius: 21 }]);
      expect(yield* handle.sensors.humidity.read()).toEqual([{ percent: 40 }]);
      expect(yield* handle.latestHumidity()).toEqual([{ percent: 40 }]);
    }).pipe(Effect.provide(SensorStore.layerMemory), Effect.scoped),
  );

  it.effect("changes(store, selector) streams only the selected shape's decoded rows", () =>
    Effect.gen(function* () {
      const handle = yield* SensorStore;
      const stream = yield* Store.changes(SensorStore, (s) => s.sensors.temperature);

      // Appended before the collect — buffered on the subscription created above. The humidity row
      // must be filtered out (wrong shape) and the temperature rows decoded, not left as raw wire.
      yield* handle.recordHumidity({ percent: 40 });
      yield* handle.recordTemp({ celsius: 21 });
      yield* handle.recordTemp({ celsius: 25 });

      const collected = yield* Stream.runCollect(Stream.take(stream, 2));
      expect(collected).toEqual([{ celsius: 21 }, { celsius: 25 }]);
    }).pipe(Effect.provide(SensorStore.layerMemory), Effect.scoped),
  );

  it.effect("changes(store) streams the decoded rows of every shape (typed-all)", () =>
    Effect.gen(function* () {
      const handle = yield* SensorStore;
      const stream = yield* Store.changes(SensorStore);

      yield* handle.recordTemp({ celsius: 21 });
      yield* handle.recordHumidity({ percent: 40 });
      yield* handle.recordAlert({ message: "hot" });

      const collected = yield* Stream.runCollect(Stream.take(stream, 3));
      expect(collected).toEqual([
        { celsius: 21 },
        { percent: 40 },
        { message: "hot" },
      ]);
    }).pipe(Effect.provide(SensorStore.layerMemory), Effect.scoped),
  );
});
