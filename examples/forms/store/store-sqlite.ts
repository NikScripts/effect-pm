import * as Store from "../../../src/Store";
/**
 * @module examples/forms/store/store-sqlite
 *
 * SQLite-backed {@link Store.Service} — rows survive reconnections.
 * Run: `npx tsx examples/forms/store/store-sqlite.ts`
 */

import { Effect, Schema } from "effect";
import { runNodeProgramOrExit } from "../../shared/demo-harness";

const readingSchema = Schema.Struct({ value: Schema.Number });

const contract = Store.contract({
  readings: Store.shape(readingSchema),
});

class AppStore extends Store.Service<AppStore>("@examples/SqliteStore")(
  Store.retention(100)(Store.register("thermo", contract)),
) {}

const filename = ".effect-pm/examples-store.sqlite";

const program = Effect.gen(function* () {
  const handle = yield* AppStore;
  yield* handle.readings.append({ value: 21 });
  yield* handle.readings.append({ value: 70 });
  const rows = yield* handle.readings.read();
  yield* Effect.log(`persisted row count: ${rows.length}`);
}).pipe(
  Effect.provide(AppStore.layer({ filename })),
  Effect.scoped,
  Effect.orDie,
);

runNodeProgramOrExit(program, "store sqlite example finished");
