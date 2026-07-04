/**
 * @module NodeStatus
 *
 * **Node status** — the reserved resource every node serves automatically (via
 * {@link Resource.httpServer}): is it up, when did it start, how long has it been up, how many
 * resources does it serve, plus its runtime-wide {@link NodeLogs} (`logs` stream + `logHistory`)
 * and a `ping`. The node author wires nothing; clients just point a transport at the node.
 *
 * The tag is **nodeless** — query a specific node by pointing the ambient `RpcClient.Protocol` at
 * that node's `/rpc`. {@link NodeStatus.clientHttp} is the batteries-included http client; for any
 * other transport, provide your own `RpcClient.Protocol` to `Resource.client(NodeStatus.Tag)`.
 *
 * ```ts
 * yield* Effect.gen(function* () {
 *   const node = yield* NodeStatus.Tag;
 *   const snap = yield* node.statusNow; // { up, startedAt, uptimeMillis, resourceCount }
 * }).pipe(Effect.provide(NodeStatus.clientHttp("http://10.0.0.2:7777/rpc")), Effect.scoped);
 * ```
 *
 * @since 1.0.0
 */
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Resource from "./Resource";
import {
  NodeStatusResource,
  nodeStatus,
  nodeResourceReadiness,
  type NodeStatus as NodeStatusType,
  type NodeResourceReadiness as NodeResourceReadinessType,
} from "./internal/nodeStatusResource";

/** Live node status: `{ up, status, startedAt, uptimeMillis, resourceCount, resources }`. The
 *  `status` rollup is `degraded` (and `/health` returns 503) when any resource is not ready.
 *  @since 1.0.0 */
export const status = nodeStatus;

/** Live node status. @since 1.0.0 */
export type Status = NodeStatusType;

/** One served resource's readiness as reported by its node — the element of `status.resources`.
 *  @since 1.0.0 */
export const resourceReadiness = nodeResourceReadiness;

/** A served resource's readiness as reported by its node. @since 1.0.0 */
export type ResourceReadiness = NodeResourceReadinessType;

/**
 * The reserved node status resource tag — nodeless. Drive it with {@link NodeStatus.clientHttp}
 * (or any `RpcClient.Protocol` layer) pointed at a node's `/rpc`. @since 1.0.0
 */
export const Tag = NodeStatusResource;

/**
 * A client layer for the node status resource pointed at a node's `/rpc` `url` (ndjson over http,
 * matching `Resource.httpServer`'s default). Provide it to a program that reads
 * {@link NodeStatus.Tag}. @since 1.0.0
 */
export const clientHttp = (url: string): Layer.Layer<NodeStatusResource> =>
  Resource.client(NodeStatusResource).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );
