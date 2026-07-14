import { Effect, Layer, Metric, Option, Schema, Stream, pipe } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Resource from "../src/Resource";
import * as ShardMap from "../src/ShardMap";
import * as Store from "../src/Store";
import { Storage } from "../src/Store";
import * as Telemetry from "../src/Telemetry";
import * as internal from "../src/internal/shardMap";
import { builtInShardMapStoreContract, makeShardMapStoreAnalyticsContract } from "../src/internal/store/shardMapStoreSpec";

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
            _tag: "gauge" as const,
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

  it.effect("auto-writes Put/Delete on layerDefaultMemory without AppStore", () => {
    class PersistSessions extends ShardMap.Tag<PersistSessions>()(
      "@test/PersistSessions",
      {
        key: SessionId,
        value: Session,
        keyOf: (s) => s.id,
      },
    ).pipe(Resource.distributed([DropletEast])) {}

    const live = ShardMap.layer(PersistSessions).pipe(
      Layer.provide(Resource.peersLayer(PersistSessions, DropletEast)),
    );

    return Effect.gen(function* () {
      const sessions = yield* PersistSessions;
      yield* sessions.put({ id: "e-1", userId: "east" });
      yield* sessions.delete("e-1");

      const bridge = yield* Storage;
      const store = yield* bridge.at(
        PersistSessions.key,
        builtInShardMapStoreContract(PersistSessions),
      );
      const events = yield* store.events();
      expect(events.map((row) => row._tag)).toEqual(["Put", "Delete"]);
      expect(events[0]).toMatchObject({
        _tag: "Put",
        key: "e-1",
        value: { id: "e-1", userId: "east" },
      });
    }).pipe(Effect.provide(live));
  });

  it.effect("hydrates the Map from persisted Put/Delete events on build", () => {
    const hydrateTag = pipe(
      ShardMap.Tag()("@test/HydrateSessions", {
        key: SessionId,
        value: Session,
        keyOf: (s: Schema.Schema.Type<typeof Session>) => s.id,
      }),
      Resource.distributed([DropletEast]),
    );
    class HydrateSessions extends hydrateTag {}

    return Effect.gen(function* () {
      const store = yield* Store.resolveOrDie(
        HydrateSessions.key,
        builtInShardMapStoreContract(HydrateSessions),
      );
      yield* store.record({
        _tag: "Put",
        key: "kept",
        value: { id: "kept", userId: "u1" },
        at: 1,
      });
      yield* store.record({
        _tag: "Put",
        key: "gone",
        value: { id: "gone", userId: "u2" },
        at: 2,
      });
      yield* store.record({
        _tag: "Delete",
        key: "gone",
        at: 3,
      });

      const impl = yield* internal.buildImpl(
        HydrateSessions as unknown as internal.EngineTag,
      );
      const getLocal = impl["getLocal"] as (
        key: string,
      ) => Effect.Effect<Option.Option<{ id: string; userId: string }>>;
      const sizeLocal = impl["sizeLocal"] as Effect.Effect<number>;

      const kept = yield* getLocal("kept");
      expect(Option.isSome(kept) && kept.value.userId).toBe("u1");
      expect(Option.isNone(yield* getLocal("gone"))).toBe(true);
      expect(yield* sizeLocal).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Store.layerDefaultMemory,
          Resource.peersLayer(HydrateSessions, DropletEast),
        ),
      ),
      Effect.scoped,
    );
  });

  it.effect("ShardMap.store analytics reconstruct current from the event log", () => {
    const analyticsTag = pipe(
      ShardMap.Tag()("@test/AnalyticsSessions", {
        key: SessionId,
        value: Session,
        keyOf: (s: Schema.Schema.Type<typeof Session>) => s.id,
      }),
      Resource.distributed([DropletEast]),
    );
    class AnalyticsSessions extends analyticsTag {}

    const live = pipe(
      ShardMap.layer(AnalyticsSessions),
      Layer.provide(Resource.peersLayer(AnalyticsSessions, DropletEast)),
    );

    return Effect.gen(function* () {
      const sessions = yield* AnalyticsSessions;
      yield* sessions.put({ id: "a", userId: "u" });
      yield* sessions.put({ id: "b", userId: "v" });
      yield* sessions.delete("a");

      const store = yield* Store.resolveOrDie(
        AnalyticsSessions.key,
        makeShardMapStoreAnalyticsContract(AnalyticsSessions),
      );
      expect(yield* store.current()).toEqual([{ id: "b", userId: "v" }]);
      expect(yield* store.stats()).toEqual({
        puts: 2,
        deletes: 1,
        currentSize: 1,
      });
      expect((yield* store.puts()).length).toBe(2);
      expect((yield* store.deletes()).length).toBe(1);
    }).pipe(Effect.provide(live));
  });
});
