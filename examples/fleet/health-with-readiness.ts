/**
 * @module examples/fleet/health-with-readiness
 *
 * `FleetHealth.layer` accepts the same readiness rows a node uses for `/health`.
 * A local degraded row becomes local `degraded` and fleet `degraded` when there
 * are no unreachable peers.
 *
 * Run: `pnpm run example:fleet-health-with-readiness`
 *
 * Docs: `docs/examples/fleet/health-with-readiness.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Effect, Layer } from "effect";
import * as FleetHealth from "../../src/FleetHealth";
import type * as Node from "../../src/Node";

class LocalHealth extends FleetHealth.Service<LocalHealth>()() {}

const readinessRows: ReadonlyArray<Node.ServiceReadiness> = [
  {
    key: "examples/readiness/Cache",
    kind: "hyperlink-ts/Hyperlink",
    ready: false,
    detail: "warming cache",
  },
  {
    key: "examples/readiness/Jobs",
    kind: "hyperlink-ts/WorkPool",
    ready: true,
  },
];

const LocalHealthLive = FleetHealth.layer(LocalHealth, {
  readiness: Effect.succeed(readinessRows),
}).pipe(Layer.provide(FleetHealth.alone(LocalHealth)));

const program = Effect.gen(function* () {
  const health = yield* LocalHealth;
  const local = yield* health.local;
  const status = yield* health.status;
  yield* Effect.logInfo(
    `local=${local.status} fleet=${status} rows=${String(local.services.length)}`,
  );
});
// ---cut-after---

runNodeProgramWithLayer(
  program,
  LocalHealthLive,
  "example:fleet-health-with-readiness finished OK",
);
