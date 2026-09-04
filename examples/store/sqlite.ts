/**
 * @module examples/store/sqlite
 *
 * SQLite-backed {@link Store.Service} — rows survive reconnections.
 * Run: `npx tsx examples/store/sqlite.ts`
 *
 * Docs: `docs/examples/store/sqlite.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import * as Store from "../../src/Store";
import { Effect, Schema } from "effect";

const readingSchema = Schema.Struct({ value: Schema.Number });

const contract = Store.contract({
  readings: Store.shape(readingSchema),
});

class AppStore extends Store.Service<AppStore>("@examples/SqliteStore")(
  Store.register("thermo", contract).pipe(Store.retention(100)),
) {}

const filename = ".hyperlink-ts/examples-store.sqlite";

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

// ---cut-after---
runNodeProgramOrExit(program, "store sqlite example finished");
