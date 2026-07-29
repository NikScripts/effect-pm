/**
 * @module examples/readiness/monitored-dependency
 *
 * `Hyperlink.monitoredDependency` builds the common `status` + `changes`
 * contract and the matching readiness derivation.
 *
 * Run: `pnpm run example:readiness-monitored-dependency`
 *
 * Docs: `docs/examples/readiness/monitored-dependency.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Effect, Schema, Stream } from "effect";
import * as Hyperlink from "../../src/Hyperlink";

const DbStatus = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
});

const { spec, readiness } = Hyperlink.monitoredDependency({
  status: DbStatus,
  changes: DbStatus,
  readyWhen: (status) => status.connected,
  detail: (status) =>
    status.connected ? `${String(status.latencyMs)}ms` : "db offline",
});

class Database extends Hyperlink.withReadiness(
  Hyperlink.Tag<Database>()("examples/readiness/MonitoredDatabase", spec),
  readiness,
) {}

const program = Effect.gen(function* () {
  const db = yield* Database;
  const status = yield* db.status;
  const check = yield* Hyperlink.readinessCheck(Database, db);
  yield* Effect.logInfo(
    `db connected=${String(status.connected)} ready=${String(check.ready)} detail=${check.detail ?? "none"}`,
  );
}).pipe(
  Effect.provide(
    Hyperlink.layer(Database, {
      status: Effect.succeed({ connected: true, latencyMs: 12 }),
      changes: Stream.empty,
    }),
  ),
);
// ---cut-after---

runNodeProgramOrExit(program, "example:readiness-monitored-dependency finished OK");
