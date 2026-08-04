/**
 * FleetHealth — stadium-board health across a meshed pack of nodes.
 *
 * Per-node readiness (`withReadiness` → `/health` / node-handle `.status`) stays **local** and never
 * hops to peers. FleetHealth is the **separate** glass: leaf `local` is this node's readiness
 * aggregate; fleet fields fold peers' `local` via {@link Hyperlink.peers} with Effect `Exit` kept
 * intact so a down neighbour is {@link Unreachable}, not silently omitted.
 *
 * ## Shape (Telemetry twin)
 *
 * - Leaf: `local` — this node's `ok` / `degraded` + per-HyperService rows (same readiness SSOT
 *   shape as `Node.Status.services`).
 * - Fleet: `byNode` / `status` — map + rollup (`ok` | `degraded` | `partial`).
 *
 * Discharge the mesh with {@link Hyperlink.peersLayer} (or {@link alone} for a single node).
 *
 * @module FleetHealth
 */
import { Effect, Exit, Layer, Schema } from "effect";
import { combineByNodeExit, combineQuery } from "./MultiNode";
import { serviceReadiness, type ServiceReadiness } from "./Node";
import * as Hyperlink from "./Hyperlink";
import {
  Service as hyperlinkTag,
  layer as hyperlinkLayer,
  serve as hyperlinkServe,
  serveRemote as hyperlinkServeRemote,
  effect,
  fleet,
  type NodeBoundTag,
  type PeersId,
  type HyperlinkTag,
  type SelfNodeId,
} from "./Hyperlink";
import type { NodeKey } from "./Node";
import * as Node from "./Node";

// ============================================================================
// Wire schema — Schema classes (Types & Naming → Prefer a class schema)
// ============================================================================

/**
 * This node's readiness aggregate — same element shape as {@link serviceReadiness}.
 *
 * @category models
 * @public
 */
export class LocalHealth extends Schema.Class<LocalHealth>("FleetHealthLocal")({
  status: Schema.Literals(["ok", "degraded"]),
  services: Schema.Array(serviceReadiness),
}) {}

/**
 * Peer answered — carry its local aggregate.
 *
 * @category models
 * @public
 */
export class Reachable extends Schema.TaggedClass<Reachable>()("Reachable", {
  status: Schema.Literals(["ok", "degraded"]),
  services: Schema.Array(serviceReadiness),
}) {}

/**
 * Peer `pick` failed (timeout / connect / RPC) — not the same as `ready: false`.
 *
 * @category models
 * @public
 */
export class Unreachable extends Schema.TaggedClass<Unreachable>()("Unreachable", {}) {}

/**
 * One node's row in {@link byNode}.
 *
 * @category wire schemas
 * @public
 */
export const nodeReport = Schema.Union([Reachable, Unreachable]);
/**
 *
 * @category models
 * @public
 */
export type NodeReport = typeof nodeReport.Type;

/**
 * Fleet rollup over {@link byNode}.
 *
 * @category wire schemas
 * @public
 */
export const fleetStatus = Schema.Literals(["ok", "degraded", "partial"]);
/**
 *
 * @category models
 * @public
 */
export type FleetStatus = typeof fleetStatus.Type;

const byNodeSchema = Schema.Record(Schema.String, nodeReport);

const fleetHealthSpec = {
  local: effect(LocalHealth).annotate({
    description:
      "This node's readiness aggregate (same SSOT shape as Node.Status.services) — leaf only.",
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

/**
 * This contract's canonical kind (stamped on every tag; read via `Hyperlink.kindOf`).
 *
 * @category utils
 * @public
 */
export const kind = "hyperlink-ts/FleetHealth";

/**
 * A FleetHealth instance tag.
 *
 * @category models
 * @public
 */
export type FleetHealthTag<Self> = HyperlinkTag<Self, FleetHealthSpec>;

/**
 * A node-bound {@link FleetHealthTag}.
 *
 * @category models
 * @public
 */
export type FleetHealthNodeTag<Self, HSelf> = NodeBoundTag<Self, FleetHealthSpec, HSelf>;

/**
 * Tag-construction options for {@link Tag}.
 *
 * @category models
 * @public
 */
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
 * class MeshHealth extends FleetHealth.Service<MeshHealth>()().pipe(
 *   Hyperlink.nodes([DropletEast, DropletWest]),
 * ) {}
 * ```
 *
 * @category constructors
 * @public
 */
export const Service = <Self>() => {
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
      ? hyperlinkTag<Self>()(key, fleetHealthSpec, {
          kind,
          description: options?.description,
        })
      : hyperlinkTag<Self>()(key, fleetHealthSpec, {
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
 * Pass the **same** per-HyperService readiness Effect {@link Node.httpServer} uses for `/health`
 * when you want FleetHealth's leaf to match the node-handle status snapshot. Absent ⇒ empty
 * HyperServices / `ok`.
 *
 * @category models
 * @public
 */
export interface FleetHealthOptions {
  readonly readiness?: Effect.Effect<ReadonlyArray<ServiceReadiness>>;
}

/** Identity node for a **non-meshed** FleetHealth instance. @internal */
class FleetHealthAloneNode extends Node.Service<FleetHealthAloneNode>()(
  "hyperlink-ts/FleetHealth/alone",
) {}

/**
 * Discharge the mesh with **no peers** — this node's readiness alone.
 *
 * @category layers & serving
 * @public
 */
export const alone = <Self>(
  tag: FleetHealthTag<Self>,
): Layer.Layer<PeersId<Self> | SelfNodeId<Self>> =>
  Layer.merge(
    Hyperlink.peersFrom(tag, {}),
    Hyperlink.selfNodeLayer(tag, FleetHealthAloneNode),
  );

/** Build {@link LocalHealth} from a readiness row list. @internal */
const localFrom = (
  services: ReadonlyArray<ServiceReadiness>,
): LocalHealth =>
  LocalHealth.make({
    status: services.every((r) => r.ready) ? "ok" : "degraded",
    services: [...services],
  });

/** {@link Reachable} from a leaf local aggregate. @internal */
const reachableOf = (local: LocalHealth): Reachable =>
  Reachable.make({ status: local.status, services: local.services });

/**
 * Roll up {@link byNode}: any {@link Unreachable} ⇒ `partial`; else any degraded ⇒ `degraded`;
 * else `ok`.
 *
 * @category combinators
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
    const self = yield* Hyperlink.selfNode(tag);
    const peers = yield* Hyperlink.peers(tag);
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
 * Local layer — wires leaf + fleet fields. Requires {@link alone} or {@link Hyperlink.peersLayer}.
 *
 * @category layers & serving
 * @public
 */
export const layer = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
): Layer.Layer<
  Self | Hyperlink.Local<Self>,
  never,
  PeersId<Self> | SelfNodeId<Self>
> =>
  buildImpl(tag, options).pipe(
    Effect.map((impl) => hyperlinkLayer(tag, impl)),
    Layer.unwrap,
  );

/**
 * Serve remotely (handlers only). Requires mesh capability.
 *
 * @category layers & serving
 * @public
 */
export const serveRemote = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
): Layer.Layer<never, never, PeersId<Self> | SelfNodeId<Self>> =>
  buildImpl(tag, options).pipe(
    Effect.map((impl) => hyperlinkServeRemote(tag, impl)),
    Layer.unwrap,
  );

/**
 * Serve **and** grant the local instance — counterpart to {@link Hyperlink.serve}.
 *
 * ```ts
 * FleetHealth.serve(MeshHealth, { readiness }).pipe(
 *   Layer.provide(Hyperlink.peersLayer(MeshHealth, DropletEast)),
 * )
 * ```
 *
 * @category layers & serving
 * @public
 */
export const serve = <Self>(
  tag: FleetHealthTag<Self>,
  options?: FleetHealthOptions,
) => hyperlinkServe(tag, buildImpl(tag, options));
