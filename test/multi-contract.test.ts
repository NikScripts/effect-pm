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

it("Resource.combined builds the fleet fields from a per-host client map", () => {
  // a fake host → per-instance client map (what a holder supplies); wnba is down (a defect, since a
  // no-error query's error channel is `never` — the runtime captures it as a failure exit).
  const peers = {
    nwsl: { connections: Effect.succeed(3), status: Effect.succeed({ connected: true }), metrics: Stream.make(1) },
    ebwsl: { connections: Effect.succeed(5), status: Effect.succeed({ connected: true }), metrics: Stream.make(2) },
    wnba: { connections: Effect.die("down"), status: Effect.die("down"), metrics: Stream.empty },
  };
  const fleet = Resource.combined(databaseSpec, peers);
  return Effect.runPromise(
    Effect.gen(function* () {
      expect(yield* fleet.totalConnections).toBe(8); // 3 + 5; wnba (down) skipped by Combine.sum
      expect(yield* fleet.fleetReporting).toBe(2); // 2 hosts answered Effect.all({conn, st})
      const merged = yield* Stream.runCollect(fleet.fleetMetrics);
      expect([...merged].sort((a, b) => a - b)).toEqual([1, 2]);
    }),
  );
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
