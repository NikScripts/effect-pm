/**
 * @module examples/fleet/telemetry-alone
 *
 * `Telemetry.alone` discharges the mesh requirements for a single node with no
 * peers. Fleet fields still work; they fold only this node.
 *
 * Run: `pnpm run example:fleet-telemetry-alone`
 *
 * Docs: `docs/examples/fleet/telemetry-alone.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Effect, Layer, Metric } from "effect";
import * as Telemetry from "../../src/Telemetry";

class LocalMetrics extends Telemetry.Tag<LocalMetrics>()() {}

const stampInFlight = (value: number) =>
  Effect.sync(() =>
    Metric.update(
      Metric.gauge(Telemetry.inFlightMetricId, {
        description: "demo queue in-flight",
      }),
      value,
    ),
  ).pipe(Effect.flatten);

const LocalTelemetryLive = Telemetry.layer(LocalMetrics).pipe(
  Layer.provide(Telemetry.alone(LocalMetrics)),
);

const program = Effect.gen(function* () {
  yield* stampInFlight(2);
  const telemetry = yield* LocalMetrics;
  const byNode = yield* telemetry.inFlightByNode;
  const total = yield* telemetry.fleetInFlight;
  yield* Effect.logInfo(
    `alone telemetry nodes=${Object.keys(byNode).length} total=${String(total)}`,
  );
});
// ---cut-after---

runNodeProgramWithLayer(
  program,
  LocalTelemetryLive,
  "example:fleet-telemetry-alone finished OK",
);
