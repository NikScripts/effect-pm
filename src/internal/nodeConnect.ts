/**
 * Shared Node dial helpers — one {@link connectLayer} implementation for
 * {@link Node.connect} and {@link Resource.client} auto-connect so MemoMap can
 * share a single transport per Node class.
 *
 * @internal
 */
import { Effect, Layer } from "effect"
import { RpcClient } from "effect/unstable/rpc"
import type { AddressedNode, AnyNode, NodeKey, ProtocolKind } from "./nodeCore"
import {
  InvalidHttpTarget,
  invalidHttpTargetOf,
  UnaddressedNode,
} from "./nodeCore"

/** Protocol builders injected from Resource (avoids Resource↔Node import cycles). */
export type NodeProtocolBuilders = {
  readonly protocolHttp: (url: string) => Layer.Layer<RpcClient.Protocol>
  readonly protocolWebsocket: (url: string) => Layer.Layer<RpcClient.Protocol>
  readonly protocolIpc: (path: string) => Layer.Layer<RpcClient.Protocol>
}

let builders: NodeProtocolBuilders | undefined

/** Called from Resource after protocol helpers exist. @internal */
export const bindNodeProtocolBuilders = (b: NodeProtocolBuilders): void => {
  builders = b
}

const protocols = (): NodeProtocolBuilders => {
  if (builders === undefined) {
    throw new Error(
      "@nikscripts/effect-pm: Node connect used before Resource protocol builders were bound",
    )
  }
  return builders
}

/**
 * Re-key an RPC protocol under a {@link Node} service — the transport-agnostic
 * primitive both {@link Node.connect} and auto-wired {@link Resource.client} use.
 *
 * @internal
 */
export const connectLayer = <Self, E, RIn>(
  node: NodeKey<Self>,
  protocol: Layer.Layer<RpcClient.Protocol, E, RIn>,
): Layer.Layer<Self, E, RIn> =>
  Layer.effect(
    node,
    Effect.map(RpcClient.Protocol, (protocol) => ({ protocol })),
  ).pipe(Layer.provide(protocol))

/** Fail a Layer build with {@link UnaddressedNode}. @internal */
export const unaddressedLayer = <A = never>(
  node: string,
): Layer.Layer<A, UnaddressedNode> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(new UnaddressedNode({ node })),
      (impossible: never): Layer.Layer<A> => impossible,
    ),
  )

/** Fail a Layer build with {@link InvalidHttpTarget}. @internal */
export const invalidHttpTargetLayer = <A = never>(
  error: InvalidHttpTarget,
): Layer.Layer<A, InvalidHttpTarget> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(error),
      (impossible: never): Layer.Layer<A> => impossible,
    ),
  )

/** Protocol for any node — invalid target / unaddressed → typed Layer fail. @internal */
export const protocolForNode = (
  node: AnyNode,
): Layer.Layer<RpcClient.Protocol, UnaddressedNode | InvalidHttpTarget> => {
  const invalid = invalidHttpTargetOf(node)
  if (invalid !== undefined) {
    return invalidHttpTargetLayer(invalid)
  }
  const { protocolHttp, protocolWebsocket, protocolIpc } = protocols()
  if (node.kind === undefined) {
    return unaddressedLayer(node.key)
  }
  if (node.kind === "IpcSocket") {
    if (node.path === undefined) {
      return unaddressedLayer(node.key)
    }
    return protocolIpc(node.path)
  }
  if (node.url === undefined) {
    return unaddressedLayer(node.key)
  }
  return node.kind === "WebSocket"
    ? protocolWebsocket(node.url)
    : protocolHttp(node.url)
}

/** Protocol for a type-narrowed {@link AddressedNode} — no error channel. @internal */
export const protocolForDialable = (
  node: AddressedNode<unknown>,
): Layer.Layer<RpcClient.Protocol> => {
  const { protocolHttp, protocolWebsocket, protocolIpc } = protocols()
  if (node.kind === "IpcSocket") {
    return protocolIpc(node.path)
  }
  return node.kind === "WebSocket"
    ? protocolWebsocket(node.url)
    : protocolHttp(node.url)
}

/**
 * Canonical derived-connect Layer per Node class — WeakMap so
 * `client(A, W)` + `client(B, W)` + `Node.connect(W)` share one MemoMap entry
 * (and one socket / HTTP client), not one per call site.
 *
 * @internal
 */
const addressedConnectMemo = new WeakMap<object, Layer.Layer<never>>()

export const connectAddressed = <Self>(
  node: AddressedNode<Self>,
): Layer.Layer<Self> => {
  const cached = addressedConnectMemo.get(node)
  if (cached !== undefined) {
    return cached as unknown as Layer.Layer<Self>
  }
  const layer = connectLayer(node, protocolForDialable(node))
  addressedConnectMemo.set(node, layer as Layer.Layer<never>)
  return layer
}

/** @internal */
export type { ProtocolKind }
