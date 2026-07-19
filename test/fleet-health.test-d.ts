/**
 * FleetHealth surface shapes — leaf vs fleet fields, Reachable/Unreachable wire, Exit fold.
 */
import { Effect, Exit, Layer } from "effect";
import * as FleetHealth from "../src/FleetHealth";
import * as MultiNode from "../src/MultiNode";
import * as Resource from "../src/Resource";

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}

class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Resource.nodes([DropletEast, DropletWest]),
) {}

type Spec = Resource.SpecOf<typeof MeshHealth>;
type Glass = Resource.Shape<MeshHealth>;

// ── Spec: leaf vs fleet ──────────────────────────────────────────────────────

type LocalNotFleet = Spec["local"] extends { readonly fleet: true } ? false : true;
true satisfies LocalNotFleet;

type ByNodeIsFleet = Spec["byNode"] extends { readonly fleet: true } ? true : false;
true satisfies ByNodeIsFleet;

type StatusIsFleet = Spec["status"] extends { readonly fleet: true } ? true : false;
true satisfies StatusIsFleet;

// ── Service members: clean Effect success types, no peer fan-in on the leaf ──

type LocalFx = Glass["local"] extends Effect.Effect<FleetHealth.LocalHealth> ? true : false;
true satisfies LocalFx;

type ByNodeFx = Glass["byNode"] extends Effect.Effect<
  Readonly<Record<string, FleetHealth.NodeReport>>
>
  ? true
  : false;
true satisfies ByNodeFx;

type StatusFx = Glass["status"] extends Effect.Effect<FleetHealth.FleetStatus> ? true : false;
true satisfies StatusFx;

// No extra leaf members sneak onto the glass.
type GlassKeys = keyof Glass;
type ExpectedKeys = "local" | "byNode" | "status";
type KeysExact = GlassKeys extends ExpectedKeys
  ? ExpectedKeys extends GlassKeys
    ? true
    : false
  : false;
true satisfies KeysExact;

// ── Wire: LocalHealth + NodeReport discriminant ──────────────────────────────

declare const local: FleetHealth.LocalHealth;
const _localStatus: "ok" | "degraded" = local.status;
void _localStatus;

declare const row: FleetHealth.NodeReport;
if (row._tag === "Reachable") {
  const _s: "ok" | "degraded" = row.status;
  const _resources: ReadonlyArray<{
    readonly key: string;
    readonly kind: string;
    readonly ready: boolean;
  }> = row.resources;
  void _s;
  void _resources;
} else {
  const _u: "Unreachable" = row._tag;
  void _u;
  // @ts-expect-error Unreachable has no status
  void row.status;
}

declare const fleet: FleetHealth.FleetStatus;
const _fleet: "ok" | "degraded" | "partial" = fleet;
void _fleet;

// rollup returns FleetStatus
const _rollup: FleetHealth.FleetStatus = FleetHealth.rollup({
  a: FleetHealth.Reachable.make({ status: "ok", resources: [] }),
  b: FleetHealth.Unreachable.make({}),
});
void _rollup;

// ── MultiNode.combineByNodeExit keeps Exit; combineByNode drops failures ─────

declare const results: ReadonlyArray<MultiNode.NodeResult<number, string>>;
const exits: Record<string, Exit.Exit<number, string>> = MultiNode.combineByNodeExit(results);
const successes: Record<string, number> = MultiNode.combineByNode(results);
void exits;
void successes;

// ── Tag construction + layer/serve/alone wiring ──────────────────────────────

class BoundGlass extends FleetHealth.Tag<BoundGlass>()({ node: DropletEast }) {}

// Spec stamped on both unbound (MeshHealth) and node-bound tags is the FleetHealth contract.
type AloneSpec = Resource.SpecOf<typeof MeshHealth>;
type BoundSpec = Resource.SpecOf<typeof BoundGlass>;
type AloneSpecKeys = keyof AloneSpec extends "local" | "byNode" | "status"
  ? "local" | "byNode" | "status" extends keyof AloneSpec
    ? true
    : false
  : false;
true satisfies AloneSpecKeys;
type BoundSpecKeys = keyof BoundSpec extends "local" | "byNode" | "status"
  ? "local" | "byNode" | "status" extends keyof BoundSpec
    ? true
    : false
  : false;
true satisfies BoundSpecKeys;

// `{ node }` overload stamps the droplet (unbound tags stay unbound).
const _boundNode: Resource.NodeKey<unknown> = Resource.nodeOf(BoundGlass)!;
void _boundNode;
type BoundHasNode = NonNullable<ReturnType<typeof Resource.nodeOf>> extends Resource.NodeKey<unknown>
  ? true
  : false;
true satisfies BoundHasNode;

const _alone: Layer.Layer<
  Resource.PeersId<MeshHealth> | Resource.SelfNodeId<MeshHealth>
> = FleetHealth.alone(MeshHealth);
void _alone;

const _layer: Layer.Layer<
  MeshHealth | Resource.Local<MeshHealth>,
  never,
  Resource.PeersId<MeshHealth> | Resource.SelfNodeId<MeshHealth>
> = FleetHealth.layer(MeshHealth);
void _layer;

const _boundLayer: Layer.Layer<
  BoundGlass | Resource.Local<BoundGlass>,
  never,
  Resource.PeersId<BoundGlass> | Resource.SelfNodeId<BoundGlass>
> = FleetHealth.layer(BoundGlass);
void _boundLayer;

const _serve = FleetHealth.serve(MeshHealth, {
  readiness: Effect.succeed([]),
});
void _serve;

const _serveRemote: Layer.Layer<
  never,
  never,
  Resource.PeersId<MeshHealth> | Resource.SelfNodeId<MeshHealth>
> = FleetHealth.serveRemote(MeshHealth);
void _serveRemote;
