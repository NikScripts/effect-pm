/**
 * FleetHealth surface shapes — leaf vs fleet fields, Reachable/Unreachable wire, Exit fold.
 */
import { Effect, Exit, Layer } from "effect";
import * as FleetHealth from "../src/FleetHealth";
import * as MultiNode from "../src/MultiNode";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}

class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Hyperlink.nodes([DropletEast, DropletWest]),
) {}

type Spec = Hyperlink.SpecOf<typeof MeshHealth>;
type Glass = Hyperlink.Shape<MeshHealth>;

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
  const _services: ReadonlyArray<{
    readonly key: string;
    readonly kind: string;
    readonly ready: boolean;
  }> = row.services;
  void _s;
  void _services;
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
  a: FleetHealth.Reachable.make({ status: "ok", services: [] }),
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
type AloneSpec = Hyperlink.SpecOf<typeof MeshHealth>;
type BoundSpec = Hyperlink.SpecOf<typeof BoundGlass>;
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
const _boundNode: Node.NodeKey<unknown> = Hyperlink.nodeOf(BoundGlass)!;
void _boundNode;
type BoundHasNode = NonNullable<ReturnType<typeof Hyperlink.nodeOf>> extends Node.NodeKey<unknown>
  ? true
  : false;
true satisfies BoundHasNode;

const _alone: Layer.Layer<
  Hyperlink.PeersId<MeshHealth> | Hyperlink.SelfNodeId<MeshHealth>
> = FleetHealth.alone(MeshHealth);
void _alone;

const _layer: Layer.Layer<
  MeshHealth | Hyperlink.Local<MeshHealth>,
  never,
  Hyperlink.PeersId<MeshHealth> | Hyperlink.SelfNodeId<MeshHealth>
> = FleetHealth.layer(MeshHealth);
void _layer;

const _boundLayer: Layer.Layer<
  BoundGlass | Hyperlink.Local<BoundGlass>,
  never,
  Hyperlink.PeersId<BoundGlass> | Hyperlink.SelfNodeId<BoundGlass>
> = FleetHealth.layer(BoundGlass);
void _boundLayer;

const _serve = FleetHealth.serve(MeshHealth, {
  readiness: Effect.succeed([]),
});
void _serve;

const _serveRemote: Layer.Layer<
  never,
  never,
  Hyperlink.PeersId<MeshHealth> | Hyperlink.SelfNodeId<MeshHealth>
> = FleetHealth.serveRemote(MeshHealth);
void _serveRemote;
