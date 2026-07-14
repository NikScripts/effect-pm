import { Effect, FileSystem, Layer, Metric, Option, Path, Schema, Stream } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Resource from "../src/Resource";
import * as ShardMap from "../src/ShardMap";
import * as Telemetry from "../src/Telemetry";

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}

describe("Telemetry fleet elevation", () => {
  class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
    Resource.distributed([DropletEast, DropletWest]),
  ) {}

  const stamp = (value: number) =>
    Effect.sync(() =>
      Metric.update(
        Metric.gauge(Telemetry.inFlightMetricId, { description: "test" }),
        value,
      ),
    ).pipe(Effect.flatten);

  it.effect("alone mesh still serves leaf snapshot + trivial fleet fold", () => {
    const live = Telemetry.layer(FleetMetrics).pipe(
      Layer.provide(Telemetry.alone(FleetMetrics)),
    );
    return Effect.gen(function* () {
      yield* stamp(2);
      const glass = yield* FleetMetrics;
      expect(Telemetry.inFlightOf(yield* glass.snapshot)).toBe(2);
      expect(yield* glass.fleetInFlight).toBe(2);
      const byNode = yield* glass.inFlightByNode;
      expect(byNode["@nikscripts/effect-pm/Telemetry/alone"]).toBe(2);
    }).pipe(Effect.provide(live));
  });

  it.effect("peers + selfNode fold queue_in_flight into fleet fields", () => {
    const peerSnap = (value: number) => ({
      snapshot: Effect.succeed({
        ts: 0,
        metrics: [
          {
            _tag: "Gauge" as const,
            id: Telemetry.inFlightMetricId,
            labels: {},
            value,
          },
        ],
      } satisfies Telemetry.MetricsSnapshot),
      live: Stream.empty as Stream.Stream<Telemetry.MetricsSnapshot>,
    });

    const live = Telemetry.layer(FleetMetrics).pipe(
      Layer.provide(
        Resource.peersFrom(FleetMetrics, {
          [DropletWest.key]: peerSnap(7),
        }),
      ),
      Layer.provide(Resource.selfNodeLayer(FleetMetrics, DropletEast)),
    );

    return Effect.gen(function* () {
      yield* stamp(5);
      const glass = yield* FleetMetrics;
      expect(yield* glass.fleetInFlight).toBe(12);
      expect(yield* glass.inFlightByNode).toEqual({
        [DropletEast.key]: 5,
        [DropletWest.key]: 7,
      });
    }).pipe(Effect.provide(live));
  });
});

describe("ShardMap", () => {
  const SessionId = Schema.String;
  const Session = Schema.Struct({
    id: SessionId,
    userId: Schema.String,
  });

  class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
    key: SessionId,
    value: Session,
    keyOf: (s) => s.id,
  }).pipe(Resource.distributed([DropletEast, DropletWest])) {}

  const sticky: ShardMap.PartitionFn = (key) =>
    key.startsWith("w-") ? DropletWest.key : DropletEast.key;

  it.effect("routes get/put to owner; folds size across peers", () => {
    const live = ShardMap.layer(Sessions, { partition: sticky }).pipe(
      Layer.provide(
        Resource.peersFrom(Sessions, {
          [DropletWest.key]: {
            get: () => Effect.succeed(Option.none()),
            put: () => Effect.succeed(false),
            delete: () => Effect.succeed(false),
            getLocal: (id: string) =>
              Effect.succeed(
                id === "w-1"
                  ? Option.some({ id: "w-1", userId: "west" })
                  : Option.none(),
              ),
            putLocal: () => Effect.void,
            deleteLocal: () => Effect.succeed(false),
            sizeLocal: Effect.succeed(1),
          },
        }),
      ),
      Layer.provide(Resource.selfNodeLayer(Sessions, DropletEast)),
    );

    return Effect.gen(function* () {
      const sessions = yield* Sessions;
      expect(yield* sessions.put({ id: "e-1", userId: "east" })).toBe(true);
      const local = yield* sessions.get("e-1");
      expect(Option.isSome(local) && local.value.userId).toBe("east");
      const west = yield* sessions.get("w-1");
      expect(Option.isSome(west) && west.value.userId).toBe("west");
      const miss = yield* sessions.get("w-missing");
      expect(Option.isNone(miss)).toBe(true);
      expect(yield* sessions.sizeByNode).toEqual({
        [DropletEast.key]: 1,
        [DropletWest.key]: 1,
      });
      expect(yield* sessions.size).toBe(2);
    }).pipe(Effect.provide(live));
  });

  it("consistentHash is stable for a fixed node set", () => {
    const nodes = [DropletEast.key, DropletWest.key, "app/DropletCentral"];
    const a = ShardMap.consistentHash("fan-90210", nodes);
    const b = ShardMap.consistentHash("fan-90210", nodes);
    expect(a).toBe(b);
    expect(nodes).toContain(a);
  });

  it.effect("default :memory: SQLite upserts live rows (no event log)", () => {
    class MemorySessions extends ShardMap.Tag<MemorySessions>()(
      "@test/MemorySessions",
      {
        key: SessionId,
        value: Session,
        keyOf: (s) => s.id,
      },
    ).pipe(Resource.distributed([DropletEast])) {}

    const live = ShardMap.layer(MemorySessions).pipe(
      Layer.provide(Resource.peersLayer(MemorySessions, DropletEast)),
    );

    return Effect.gen(function* () {
      const sessions = yield* MemorySessions;
      yield* sessions.put({ id: "a", userId: "u" });
      yield* sessions.put({ id: "a", userId: "u2" }); // upsert
      yield* sessions.put({ id: "b", userId: "v" });
      yield* sessions.delete("b");
      expect(yield* sessions.sizeLocal).toBe(1);
      const a = yield* sessions.get("a");
      expect(Option.isSome(a) && a.value.userId).toBe("u2");
    }).pipe(Effect.provide(live));
  });

  it.effect("file SQLite rehydrates live keys across rematerialization", () => {
    class FileSessions extends ShardMap.Tag<FileSessions>()("@test/FileSessions", {
      key: SessionId,
      value: Session,
      keyOf: (s) => s.id,
    }).pipe(Resource.distributed([DropletEast])) {}

    return Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* Effect.acquireRelease(
        fs.makeTempDirectory().pipe(Effect.orDie),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "shard.sqlite");
      const mesh = Resource.peersLayer(FileSessions, DropletEast);
      const live = ShardMap.layer(FileSessions, { filename }).pipe(
        Layer.provide(mesh),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* FileSessions;
          yield* sessions.put({ id: "kept", userId: "u1" });
          yield* sessions.put({ id: "gone", userId: "u2" });
          yield* sessions.delete("gone");
        }).pipe(Effect.provide(live)),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* FileSessions;
          const kept = yield* sessions.get("kept");
          expect(Option.isSome(kept) && kept.value.userId).toBe("u1");
          expect(Option.isNone(yield* sessions.get("gone"))).toBe(true);
          expect(yield* sessions.sizeLocal).toBe(1);
        }).pipe(Effect.provide(live)),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
  });
});
