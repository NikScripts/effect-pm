import { Effect, Schema, Stream } from "effect";
import { expect, it } from "vitest";
import { Combine } from "../src/MultiHost";
import * as Resource from "../src/Resource";

const DbStatus = Schema.Struct({ connected: Schema.Boolean });

// The locked shape: contract({per-instance}).pipe(multi((m) => ({fleet fields})))
const databaseSpec = Resource.contract({
  connections: Resource.query(Schema.Number),
  status: Resource.query(DbStatus),
  metrics: Resource.stream(Schema.Number),
}).pipe(
  Resource.multi((m) => ({
    totalConnections: m.query((host) => host.connections, Combine.sum),
    fleetMetrics: m.stream((host) => host.metrics, Combine.mergeStreams),
    // full per-host client, fold over several fields → arbitrary output
    fleetReporting: m.query(
      (host) => Effect.all({ conn: host.connections, st: host.status }),
      (results) => Combine.successes(results).length,
    ),
  })),
);

it("contract().pipe(multi(...)) merges per-instance + multi fields into one spec", () => {
  const spec = Resource.specFromContract(databaseSpec);
  expect(Object.keys(spec).sort()).toEqual([
    "connections",
    "fleetMetrics",
    "fleetReporting",
    "metrics",
    "status",
    "totalConnections",
  ]);
});

it("ServiceOf surfaces multi fields precisely (query → Effect, stream → Stream)", () => {
  type S = typeof databaseSpec extends Resource.Contract<infer Sp> ? Sp : never;
  type Svc = Resource.ServiceOf<S>;
  // query multi field → Effect<number>; stream multi field → Stream<number>; per-instance unchanged
  const total: Svc["totalConnections"] extends Effect.Effect<number, never, never> ? true : false = true;
  const stream: Svc["fleetMetrics"] extends Stream.Stream<number, never, never> ? true : false = true;
  const report: Svc["fleetReporting"] extends Effect.Effect<number, never, never> ? true : false = true;
  const conn: Svc["connections"] extends Effect.Effect<number, never, never> ? true : false = true;
  expect([total, stream, report, conn]).toEqual([true, true, true, true]);
});
