import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { combineByNodeExit, combineQuery } from "../src/MultiNode";
import * as FleetHealth from "../src/FleetHealth";
import * as Resource from "../src/Resource";

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}

describe("MultiNode.combineByNodeExit", () => {
  it.effect("keeps successful and failed peer exits", () =>
    Effect.gen(function* () {
      const peers = {
        west: { local: Effect.succeed(1) },
        gone: { local: Effect.die("down") },
      };
      const exits = yield* combineQuery(peers, (p) => p.local, combineByNodeExit);
      expect(Exit.isSuccess(exits.west!)).toBe(true);
      expect(Exit.isFailure(exits.gone!)).toBe(true);
    }),
  );
});

describe("FleetHealth", () => {
  class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
    Resource.distributed([DropletEast, DropletWest]),
  ) {}

  const peerLocal = (status: "ok" | "degraded", ready: boolean) => ({
    local: Effect.succeed(
      FleetHealth.LocalHealth.make({
        status,
        resources: [{ key: "app/Jobs", kind: "@nikscripts/effect-pm/QueueResource", ready }],
      }),
    ),
  });

  it.effect("alone mesh: leaf ok + trivial fleet fold", () => {
    const readiness = Effect.succeed([
      { key: "app/Cache", kind: "@nikscripts/effect-pm/Resource", ready: true },
    ]);
    const live = FleetHealth.layer(MeshHealth, { readiness }).pipe(
      Layer.provide(FleetHealth.alone(MeshHealth)),
    );
    return Effect.gen(function* () {
      const glass = yield* MeshHealth;
      const local = yield* glass.local;
      expect(local.status).toBe("ok");
      expect(local.resources).toHaveLength(1);
      expect(yield* glass.status).toBe("ok");
      const byNode = yield* glass.byNode;
      expect(Object.keys(byNode)).toEqual(["@nikscripts/effect-pm/FleetHealth/alone"]);
      expect(byNode["@nikscripts/effect-pm/FleetHealth/alone"]?._tag).toBe("Reachable");
    }).pipe(Effect.provide(live));
  });

  it.effect("peers fold Reachable rows + rollup degraded", () => {
    const readiness = Effect.succeed([
      { key: "app/Cache", kind: "@nikscripts/effect-pm/Resource", ready: true },
    ]);
    const live = FleetHealth.layer(MeshHealth, { readiness }).pipe(
      Layer.provide(
        Resource.peersFrom(MeshHealth, {
          [DropletWest.key]: peerLocal("degraded", false),
        }),
      ),
      Layer.provide(Resource.selfNodeLayer(MeshHealth, DropletEast)),
    );
    return Effect.gen(function* () {
      const glass = yield* MeshHealth;
      const byNode = yield* glass.byNode;
      expect(byNode[DropletEast.key]?._tag).toBe("Reachable");
      const west = byNode[DropletWest.key];
      expect(west?._tag).toBe("Reachable");
      if (west !== undefined && west._tag === "Reachable") {
        expect(west.status).toBe("degraded");
      }
      expect(yield* glass.status).toBe("degraded");
    }).pipe(Effect.provide(live));
  });

  it.effect("peer defect ⇒ Unreachable and status partial", () => {
    const readiness = Effect.succeed([
      { key: "app/Cache", kind: "@nikscripts/effect-pm/Resource", ready: true },
    ]);
    // Defect (die) keeps `local`'s error channel `never` while Exit is still Failure — Effect-true.
    const live = FleetHealth.layer(MeshHealth, { readiness }).pipe(
      Layer.provide(
        Resource.peersFrom(MeshHealth, {
          [DropletWest.key]: { local: Effect.die("timeout") },
        }),
      ),
      Layer.provide(Resource.selfNodeLayer(MeshHealth, DropletEast)),
    );
    return Effect.gen(function* () {
      const glass = yield* MeshHealth;
      const byNode = yield* glass.byNode;
      expect(byNode[DropletWest.key]?._tag).toBe("Unreachable");
      expect(yield* glass.status).toBe("partial");
      expect(FleetHealth.rollup(byNode)).toBe("partial");
    }).pipe(Effect.provide(live));
  });
});
