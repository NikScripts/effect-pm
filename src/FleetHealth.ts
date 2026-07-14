/**
 * FleetHealth — stadium-board health across a meshed pack of nodes.
 *
 * Per-node readiness (`withReadiness` → `/health` / `NodeStatus`) stays **local** and never hops to
 * peers. FleetHealth is the **separate** glass: leaf `local` is this node's readiness aggregate;
 * fleet fields fold peers' `local` via {@link Resource.peers} with Effect `Exit` kept intact so a
 * down neighbour is {@link Unreachable}, not silently omitted.
 *
 * ## Shape (Telemetry twin)
 *
 * - Leaf: `local` — this node's `ok` / `degraded` + per-resource rows (same readiness SSOT
 *   shape as `NodeStatus.resources`).
 * - Fleet: `byNode` / `status` — map + rollup (`ok` | `degraded` | `partial`).
 *
 * Discharge the mesh with {@link Resource.peersLayer} (or {@link alone} for a single node).
 *
 * @module FleetHealth
 */
import { Effect, Exit, Layer, Schema } from "effect";
import { combineByNodeExit, combineQuery } from "./MultiNode";
import * as NodeStatus from "./NodeStatus";
import * as Resource from "./Resource";
import {
  Tag as resourceTag,
  layer as resourceLayer,
  serve as resourceServe,
  serveRemote as resourceServeRemote,
  effect,
  fleet,
  type NodeBoundTag,
  type NodeKey,
  type PeersId,
  type ResourceTag,
  type SelfNodeId,
} from "./Resource";

// ============================================================================
// Wire schema — Schema classes (Types & Naming → Prefer a class schema)
// ============================================================================

/**
 * This node's readiness aggregate — same element shape as {@link NodeStatus.resourceReadiness}.
 *
 * @public
 */
export class LocalHealth extends Schema.Class<LocalHealth>("FleetHealthLocal")({
  status: Schema.Literals(["ok", "degraded"]),
  resources: Schema.Array(NodeStatus.resourceReadiness),
}) {}

/**
 * Peer answered — carry its local aggregate.
 *
 * @public
 */
export class Reachable extends Schema.TaggedClass<Reachable>()("Reachable", {
  status: Schema.Literals(["ok", "degraded"]),
  resources: Schema.Array(NodeStatus.resourceReadiness),
}) {}

/**
 * Peer `pick` failed (timeout / connect / RPC) — not the same as `ready: false`.
 *
 * @public
 */
export class Unreachable extends Schema.TaggedClass<Unreachable>()("Unreachable", {}) {}

/** One node's row in {@link byNode}. @public */
export const nodeReport = Schema.Union([Reachable, Unreachable]);
/** @public */
export type NodeReport = typeof nodeReport.Type;

/** Fleet rollup over {@link byNode}. @public */
export const fleetStatus = Schema.Literals(["ok", "degraded", "partial"]);
/** @public */
export type FleetStatus = typeof fleetStatus.Type;

const byNodeSchema = Schema.Record(Schema.String, nodeReport);

const fleetHealthSpec = {
  local: effect(LocalHealth).annotate({
    description:
      "This node's readiness aggregate (same SSOT shape as NodeStatus.resources) — leaf only.",
  }),
  byNode: effect(byNodeSchema).pipe(fleet).annotate({
    description:
      "Per-node health — Reachable (peer's local) or Unreachable (Exit failure). Self always Reachable.",
  }),
  status: effect(fleetStatus).pipe(fleet).annotate({
    description:
      "`ok` = all reachable & ok; `degraded` = some reachable but degraded; `partial` = any Unreachable.",
  }),
};

/** @internal */
export type FleetHealthSpec = typeof fleetHealthSpec;

/** This contract's canonical kind (stamped on every tag; read via `Resource.kindOf`). @public */
export const kind = "@nikscripts/effect-pm/FleetHealth";

/** A FleetHealth instance tag. @public */
export type FleetHealthTag<Self> = ResourceTag<Self, FleetHealthSpec>;

/** A node-bound {@link FleetHealthTag}. @public */
export type FleetHealthNodeTag<Self, HSelf> = NodeBoundTag<Self, FleetHealthSpec, HSelf>;

/** Tag-construction options for {@link Tag}. @public */
export interface FleetHealthConstructOptions<HSelf = never> {
  readonly node?: NodeKey<HSelf>;
  readonly description?: string;
}

const defaultKey = "fleet-health";
const keyFor = (node: NodeKey<unknown> | undefined): string =>
  node === undefined ? defaultKey : `${node.key}/${defaultKey}`;

/**
 * Declare a FleetHealth tag:
 *
 * ```ts
 * class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
 *   Resource.distributed([DropletEast, DropletWest]),
 * ) {}
 * ```
 *
 * @public
 */
export const Tag = <Self>() => {
  function build(): FleetHealthTag<Self>;
  function build<HSelf>(options: {
    readonly node: NodeKey<HSelf>;
    readonly description?: string;
  }): FleetHealthNodeTag<Self, HSelf>;
  function build(
    options?: FleetHealthConstructOptions<unknown>,
  ): FleetHealthTag<Self> {
    const node = options?.node;
    const key = keyFor(node);
    return node === undefined
      ? resourceTag<Self>()(key, fleetHealthSpec, {
          kind,
          description: options?.description,
        })
      : resourceTag<Self>()(key, fleetHealthSpec, {
          kind,
          description: options?.description,
          node,
        });
  }
  return build;
};

// ============================================================================
// Engine
// ============================================================================

/**
 * Options for {@link layer} / {@link serve} / {@link serveRemote}.
 *
 * Pass the **same** per-resource readiness Effect {@link Resource.httpServer} uses for `/health`
 * when you want FleetHealth's leaf to match NodeStatus. Absent ⇒ empty resources / `ok`.
 *
 * @public
 */
export interface FleetHealthOptions {
  readonly readiness?: Effect.Effect<ReadonlyArray<NodeStatus.ResourceReadiness>>;
}

/** Identity node for a **non-meshed** FleetHealth instance. @internal */
class FleetHealthAloneNode extends Resource.Node<FleetHealthAloneNode>(
  "@nikscripts/effect-pm/FleetHealth/alone",
) {}

/**
 * Discharge the mesh with **no peers** — this node's readiness alone.
 *
 * @public
 */
export const alone = <Self>(
  tag: FleetHealthTag<Self>,
): Layer.Layer<PeersId<Self> | SelfNodeId<Self>> =>
  Layer.merge(
    Resource.peersFrom(tag, {}),
    Resource.selfNodeLayer(tag, FleetHealthAloneNode),
  );

/** Build {@link LocalHealth} from a readiness row list. @internal */
const localFrom = (
  resources: ReadonlyArray<NodeStatus.ResourceReadiness>,
): LocalHealth =>
  LocalHealth.make({
    status: resources.every((r) => r.ready) ? "ok" : "degraded",
    resources: [...resources],
  });

/** {@link Reachable} from a leaf local aggregate. @internal */
const reachableOf = (local: LocalHealth): Reachable =>
  Reachable.make({ status: local.status, resources: local.resources });

/**
 * Roll up {@link byNode}: any {@link Unreachable} ⇒ `partial`; else any degraded ⇒ `degraded`;
 * else `ok`.
 *
 * @public
 */
export const rollup = (byNode: Readonly<Record<string, NodeReport>>): FleetStatus => {
  const rows = Object.values(byNode);
  if (rows.some((r) => r._tag === "Unreachable")) return "partial";
  if (rows.some((r) => r._tag === "Reachable" && r.status === "degraded")) return "degraded";
  return "ok";
};

/**
 * Map peer `Exit`s to wire rows — success → {@link Reachable}, failure → {@link Unreachable}.
 * Self is always inserted as {@link Reachable}.
 *
 * @internal
 */
const foldByNode = (
  self: string,
  peers: Record<string, { readonly local: Effect.Effect<LocalHealth> }>,
  own: LocalHealth,
): Effect.Effect<Record<string, NodeReport>> =>
  Effect.gen(function* () {
    const exits = yield* combineQuery(peers, (peer) => peer.local, combineByNodeExit);
    const byNode: Record<string, NodeReport> = {};
    for (const [node, exit] of Object.entries(exits)) {
      byNode[node] = Exit.match(exit, {
        onFailure: () => Unreachable.make({}),
        onSuccess: (local) => reachableOf(local),
      });
    }
    byNode[self] = reachableOf(own);
    return byNode;
  });

/**
 * Served impl — resolves peers/self once; members close over them (Telemetry twin).
 *
 * @internal
 */
const buildImpl = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
): Effect.Effect<
  {
    readonly local: Effect.Effect<LocalHealth>;
    readonly byNode: Effect.Effect<Readonly<Record<string, NodeReport>>>;
    readonly status: Effect.Effect<FleetStatus>;
  },
  never,
  PeersId<Self> | SelfNodeId<Self>
> =>
  Effect.gen(function* () {
    const self = yield* Resource.selfNode(tag);
    const peers = yield* Resource.peers(tag);
    const readiness = options?.readiness ?? Effect.succeed([]);
    const local = readiness.pipe(Effect.map(localFrom));
    return {
      local,
      byNode: Effect.gen(function* () {
        const own = yield* local;
        return yield* foldByNode(self, peers, own);
      }),
      status: Effect.gen(function* () {
        const own = yield* local;
        const byNode = yield* foldByNode(self, peers, own);
        return rollup(byNode);
      }),
    };
  });

/**
 * Local layer — wires leaf + fleet fields. Requires {@link alone} or {@link Resource.peersLayer}.
 *
 * @public
 */
export const layer = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
): Layer.Layer<
  Self | Resource.Local<Self>,
  never,
  PeersId<Self> | SelfNodeId<Self>
> =>
  buildImpl(tag, options).pipe(
    Effect.map((impl) => resourceLayer(tag, impl)),
    Layer.unwrap,
  );

/**
 * Serve remotely (handlers only). Requires mesh capability.
 *
 * @public
 */
export const serveRemote = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
): Layer.Layer<never, never, PeersId<Self> | SelfNodeId<Self>> =>
  buildImpl(tag, options).pipe(
    Effect.map((impl) => resourceServeRemote(tag, impl)),
    Layer.unwrap,
  );

/**
 * Serve **and** grant the local instance — counterpart to {@link Resource.serve}.
 *
 * ```ts
 * FleetHealth.serve(MeshHealth, { readiness }).pipe(
 *   Layer.provide(Resource.peersLayer(MeshHealth, DropletEast)),
 * )
 * ```
 *
 * @public
 */
export const serve = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
) => resourceServe(tag, buildImpl(tag, options));
