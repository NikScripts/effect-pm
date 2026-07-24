import * as Hyperlink from "../../../src/Hyperlink";
import * as Store from "../../../src/Store";
/**
 * @module examples/forms/store/store-memory
 *
 * In-memory {@link Store.Service} with shape-first contracts.
 * Run: `npx tsx examples/forms/store/store-memory.ts`
 */

import { Effect, Schema, Stream } from "effect";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const readingSchema = Schema.Struct({ value: Schema.Number });

const contract = Store.contract(
  { readings: readingSchema },
  ({ readings }) => ({
    latest: readings.read,
  }),
);

class LabSensor extends Hyperlink.Tag<LabSensor>()("@examples/LabSensor", {
  temperature: Hyperlink.ref(Schema.Number),
}).pipe(Hyperlink.withStore(contract)) {}

class AppStore extends Store.Service<AppStore>("@examples/Store")(
  Store.scoped(LabSensor, contract),
  Store.register("bench", contract),
) {}

const program: Effect.Effect<
  void,
  never,
  AppStore | Store.Storage
> = Effect.gen(function* () {
  const sensor = yield* LabSensor.store;
  const bench = yield* AppStore.at("bench");

  yield* sensor.readings.append({ value: 72 });
  yield* bench.readings.append({ value: 68 });

  const sensorRows = yield* sensor.latest();
  const benchRows = yield* bench.latest();

  yield* Effect.log(`sensor count: ${sensorRows.length}`);
  yield* Effect.log(`bench count: ${benchRows.length}`);

  const events = yield* Store.changes(LabSensor);
  const collected = yield* events.pipe(Stream.take(1), Stream.runCollect);
  yield* Effect.log(`subscribed to changes (buffer size ${collected.length})`);
}).pipe(Effect.scoped, Effect.orDie);

runNodeProgramWithLayer(program, AppStore.layerMemory, "store memory example finished");
