/**
 * @module examples/store/memory
 *
 * In-memory {@link Store.Service} with shape-first contracts.
 * Run: `npx tsx examples/store/store-memory.ts`
 *
 * Docs: `docs/examples/store/memory.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// ---cut---
import * as Hyperlink from "../../src/Hyperlink";
import * as Store from "../../src/Store";
import { Effect, Schema, Stream } from "effect";

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

const program = Effect.gen(function* () {
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
});

// ---cut-after---
runNodeProgramWithLayer(Effect.scoped(program), AppStore.layerMemory, "store memory example finished");
