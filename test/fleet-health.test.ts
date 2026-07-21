import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { combineByNode, combineByNodeExit, combineQuery } from "../src/MultiNode";
import * as FleetHealth from "../src/FleetHealth";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}

describe("MultiNode.combineByNode vs combineByNodeExit", () => {
  it.effect("combineByNodeExit keeps every peer; combineByNode drops failures", () =>
    Effect.gen(function* () {
      const peers = {
        west: { local: Effect.succeed(1) },
        gone: { local: Effect.die("down") },
      };
      const exits = yield* combineQuery(peers, (p) => p.local, combineByNodeExit);
      expect(Exit.isSuccess(exits.west!)).toBe(true);
      expect(Exit.isFailure(exits.gone!)).toBe(true);
      expect(Object.keys(exits).sort()).toEqual(["gone", "west"]);

      const survivors = yield* combineQuery(peers, (p) => p.local, combineByNode);
      expect(survivors).toEqual({ west: 1 });
      expect("gone" in survivors).toBe(false);
    }),
  );
});

describe("FleetHealth.rollup", () => {
  const ok = FleetHealth.Reachable.make({ status: "ok", resources: [] });
  const degraded = FleetHealth.Reachable.make({ status: "degraded", resources: [] });
  const down = FleetHealth.Unreachable.make({});

  it("ok when every row is Reachable + ok", () => {
    expect(FleetHealth.rollup({ a: ok, b: ok })).toBe("ok");
  });

  it("degraded when any Reachable is degraded and none Unreachable", () => {
    expect(FleetHealth.rollup({ a: ok, b: degraded })).toBe("degraded");
  });

  it("partial wins over degraded when any Unreachable", () => {
    expect(FleetHealth.rollup({ a: degraded, b: down })).toBe("partial");
    expect(FleetHealth.rollup({ a: ok, b: down })).toBe("partial");
  });
});

describe("FleetHealth", () => {
  class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
    Resource.nodes([DropletEast, DropletWest]),
  ) {}

  const peerLocal = (status: "ok" | "degraded", ready: boolean) => ({
    local: Effect.succeed(
      FleetHealth.LocalHealth.make({
        status,
        resources: [{ key: "app/Jobs", kind: "@nikscripts/effect-pm/QueueResource", ready }],
      }),
    ),
  });

  it.effect("default readiness ⇒ empty resources / ok", () => {
    const live = FleetHealth.layer(MeshHealth).pipe(
      Layer.provide(FleetHealth.alone(MeshHealth)),
    );
    return Effect.gen(function* () {
      const glass = yield* MeshHealth;
      const local = yield* glass.local;
      expect(local.status).toBe("ok");
      expect(local.resources).toEqual([]);
      expect(yield* glass.status).toBe("ok");
    }).pipe(Effect.provide(live));
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

  it.effect("leaf degraded when any readiness row is not ready", () => {
    const readiness = Effect.succeed([
      { key: "app/Cache", kind: "@nikscripts/effect-pm/Resource", ready: true },
      { key: "app/Jobs", kind: "@nikscripts/effect-pm/QueueResource", ready: false },
    ]);
    const live = FleetHealth.layer(MeshHealth, { readiness }).pipe(
      Layer.provide(FleetHealth.alone(MeshHealth)),
    );
    return Effect.gen(function* () {
      const glass = yield* MeshHealth;
      const local = yield* glass.local;
      expect(local.status).toBe("degraded");
      expect(local.resources.map((r) => r.key)).toEqual(["app/Cache", "app/Jobs"]);
      // alone ⇒ only self, so fleet status mirrors leaf degraded
      expect(yield* glass.status).toBe("degraded");
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
      expect(byNode[DropletEast.key]?._tag).toBe("Reachable");
      expect(Object.keys(byNode).sort()).toEqual(
        [DropletEast.key, DropletWest.key].sort(),
      );
      expect(yield* glass.status).toBe("partial");
      expect(FleetHealth.rollup(byNode)).toBe("partial");
    }).pipe(Effect.provide(live));
  });

  it.effect("kind is stamped on the tag", () =>
    Effect.sync(() => {
      expect(Resource.kindOf(MeshHealth)).toBe(FleetHealth.kind);
      expect(FleetHealth.kind).toBe("@nikscripts/effect-pm/FleetHealth");
    }),
  );

  it("Tag()() is unbound; Tag()({ node }) stamps the droplet", () => {
    // MeshHealth is `Tag()()` (default key already claimed) — still unbound after distributed.
    expect(Resource.nodeOf(MeshHealth)).toBeUndefined();
    class BoundGlass extends FleetHealth.Tag<BoundGlass>()({ node: DropletEast }) {}
    expect(Resource.nodeOf(BoundGlass)).toBe(DropletEast);
  });
});
