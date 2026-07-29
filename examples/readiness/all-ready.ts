/**
 * @module examples/readiness/all-ready
 *
 * Compose readiness checks with `Hyperlink.allReady`. `Worker` keeps its own
 * base check and also depends on `Database` readiness.
 *
 * Run: `pnpm run example:readiness-all-ready`
 *
 * Docs: `docs/examples/readiness/all-ready.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";

class Database extends Hyperlink.Tag<Database>()("examples/readiness/Database", {
  connected: Hyperlink.effect(Schema.Boolean),
}).pipe(
  Hyperlink.withReadiness((svc) =>
    Effect.map(svc.connected, (connected) =>
      connected
        ? { ready: true }
        : { ready: false, detail: "database disconnected" },
    ),
  ),
) {}

class Worker extends Hyperlink.Tag<Worker>()("examples/readiness/Worker", {
  running: Hyperlink.effect(Schema.Boolean),
}).pipe(
  Hyperlink.withReadiness((svc) =>
    Effect.map(svc.running, (running) =>
      running ? { ready: true } : { ready: false, detail: "worker stopped" },
    ),
  ),
  Hyperlink.withReadiness((_svc, base) =>
    Hyperlink.allReady([base, Hyperlink.readinessOf(Database)]),
  ),
) {}

const program = Effect.gen(function* () {
  const worker = yield* Worker;
  const readiness = yield* Hyperlink.readinessCheck(Worker, worker);
  yield* Effect.logInfo(
    `worker ready=${String(readiness.ready)} detail=${readiness.detail ?? "none"}`,
  );
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      Hyperlink.layer(Database, { connected: Effect.succeed(false) }),
      Hyperlink.layer(Worker, { running: Effect.succeed(true) }),
    ),
  ),
);
// ---cut-after---

runNodeProgramOrExit(program, "example:readiness-all-ready finished OK");
