/**
 * @module NodeStatus
 *
 * **Node status** — the reserved resource every node serves automatically (via
 * {@link Node.httpServer}): is it up, when did it start, how long has it been up, how many
 * resources does it serve, plus its runtime-wide **Logs** relay (`logs.stream` stream +
 * `logs.query` query — empty unless `Logs.layer` is provided) and a `ping`. The node author wires nothing; clients just point a transport
 * at the node. — query a specific node by pointing the ambient `RpcClient.Protocol` at
 * that node's `/rpc`. {@link NodeStatus.clientHttp} is the batteries-included http client; for any
 * other transport, provide your own `RpcClient.Protocol` to `Hyperlink.client(NodeStatus.Tag)`.
 *
 * ```ts
 * yield* Effect.gen(function* () {
 *   const node = yield* NodeStatus.Tag;
 *   const snap = yield* node.status.get; // { up, startedAt, uptimeMillis, resourceCount }
 * }).pipe(Effect.provide(NodeStatus.clientHttp("http://10.0.0.2:7777/rpc")), Effect.scoped);
 * ```
 *
 */
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Hyperlink from "./Hyperlink";
import type { AddressedNode } from "./Node";
import {
  NodeStatusHyperlink,
  nodeStatus,
  nodeHyperlinkReadiness,
  type NodeStatus as NodeStatusType,
  type NodeHyperlinkReadiness as NodeHyperlinkReadinessType,
} from "./internal/nodeStatusHyperlink";

/** Live node status: `{ up, status, startedAt, uptimeMillis, resourceCount, resources }`. The
 *  `status` rollup is `degraded` (and `/health` returns 503) when any resource is not ready.
 * @category wire schemas
 *  @public */
export const status = nodeStatus;

/**
 * Live node status.
 *
 * @category models
 * @public
 */
export type Status = NodeStatusType;

/** One served resource's readiness as reported by its node — the element of `status.resources`.
 * @category wire schemas
 *  @public */
export const resourceReadiness = nodeHyperlinkReadiness;

/**
 * A served resource's readiness as reported by its node.
 *
 * @category models
 * @public
 */
export type ResourceReadiness = NodeHyperlinkReadinessType;

/**
 * The reserved node-status **service** — you never declare one (it's auto-served by every node);
 * you *dial + read* it, the `HttpClient` shape. Provide a client layer ({@link NodeStatus.client}
 * for a node, or {@link NodeStatus.clientHttp} for a url), then `yield*` this tag to read
 * `status` / `logs` / `ping`. Not a resource kind like `WorkPool` / `Gate` / `Daemon`.
 *
 * @category services
 * @public
 */
export const Tag = NodeStatusHyperlink;

/**
 * A client layer for the node status resource pointed at a node's `/rpc` `url` (ndjson over http,
 * matching `Node.httpServer`'s default). Provide it to a program that reads
 * {@link NodeStatus.Tag}.
 *
 * @category clients
 * @public
 */
export const clientHttp = (url: string): Layer.Layer<NodeStatusHyperlink> =>
  Hyperlink.client(NodeStatusHyperlink).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );

/**
 * A client layer for a **node's** reserved status resource — the node-addressed parallel of
 * {@link clientHttp}. Auto-connects to `node` (its declared transport) with default-on client verify
 * disabled, because this *is* the health probe. Provide it, then read {@link Tag} — the status is a
 * plumbing **service** you dial + read (the `HttpClient` shape), not a resource kind you declare.
 *
 * ```ts
 * yield* Effect.gen(function* () {
 *   const pulse = yield* NodeStatus.Tag;
 *   const snap = yield* pulse.status.get;
 * }).pipe(Effect.provide(NodeStatus.client(Droplet)), Effect.scoped);
 * ```
 *
 * @category clients
 * @public
 */
export const client = (node: AddressedNode<unknown>) =>
  Hyperlink.client(NodeStatusHyperlink, node).pipe(
    Layer.provide(Hyperlink.clientVerify(false)),
  );
