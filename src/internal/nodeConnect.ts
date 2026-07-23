/**
 * Shared Node dial helpers — one {@link connectLayer} implementation for
 * {@link Node.connect} and {@link Hyperlink.client} auto-connect so MemoMap can
 * share a single transport per Node class.
 *
 * @internal
 */
import { Context, Effect, Layer, Stream } from "effect"
import { RpcClient } from "effect/unstable/rpc"
import type {
  AddressedNode,
  AnyNode,
  Endpoints,
  NodeKey,
  NodeStatusAccessors,
  ProtocolKind,
} from "./nodeCore"
import {
  InvalidHttpTarget,
  invalidHttpTargetOf,
  portOf,
  UnaddressedNode,
} from "./nodeCore"

/** Protocol builders injected from Hyperlink (avoids Hyperlink↔Node import cycles). @internal */
export type NodeProtocolBuilders = {
  // `protocolHttp` takes a port too — a bare-port node resolves its host via Config at the dial.
  readonly protocolHttp: (target: number | string) => Layer.Layer<RpcClient.Protocol>
  readonly protocolWebsocket: (url: string) => Layer.Layer<RpcClient.Protocol>
  readonly protocolIpc: (path: string) => Layer.Layer<RpcClient.Protocol>
}

let builders: NodeProtocolBuilders | undefined

/** Called from Hyperlink after protocol helpers exist. @internal */
export const bindNodeProtocolBuilders = (b: NodeProtocolBuilders): void => {
  builders = b
}

const protocols = (): NodeProtocolBuilders => {
  if (builders === undefined) {
    throw new Error(
      "hyperlink-ts: Node connect used before Hyperlink protocol builders were bound",
    )
  }
  return builders
}

/**
 * The status/logs/ping accessors on a connected node handle — lazy over the node's own `protocol`.
 * Each dynamically imports the status engine on access (so nodeConnect never statically pulls it,
 * and it stays off the light Tag path); the real dial logic is `nodeStatus.nodeStatusAccessors`.
 * @internal
 */
const lazyStatusAccessors = (
  protocol: Context.Service.Shape<typeof RpcClient.Protocol>,
): NodeStatusAccessors => {
  const load = Effect.promise(() => import("./nodeStatus"))
  const of = (protocol: Context.Service.Shape<typeof RpcClient.Protocol>) =>
    Effect.map(load, (m) => m.nodeStatusAccessors(protocol))
  return {
    ping: Effect.flatMap(of(protocol), (a) => a.ping),
    status: {
      get: Effect.flatMap(of(protocol), (a) => a.status.get),
      changes: Stream.unwrap(Effect.map(of(protocol), (a) => a.status.changes)),
    },
    logs: {
      stream: Stream.unwrap(Effect.map(of(protocol), (a) => a.logs.stream)),
      query: (options) => Effect.flatMap(of(protocol), (a) => a.logs.query(options)),
    },
  }
}

/** Provide a node handle for `node` over `protocol` — its `{ protocol }` plus lazy status accessors. @internal */
export const connectLayer = <Self, E, RIn>(
  node: NodeKey<Self>,
  protocol: Layer.Layer<RpcClient.Protocol, E, RIn>,
): Layer.Layer<Self, E, RIn> =>
  Layer.effect(
    node,
    Effect.map(RpcClient.Protocol, (protocol) => ({
      protocol,
      ...lazyStatusAccessors(protocol),
    })),
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

/**
 * Which endpoint {@link connect} dials from a node's transport `endpoints` set. A **multi-protocol**
 * node prefers WebSocket in a browser (past HTTP/1.1's ~6-conn cap, and dodging the http-in-browser
 * death) and Http elsewhere; a single-endpoint node uses its one. Falls back to the node's primary
 * `kind`/`url`/`path` (single-protocol nodes and any not carrying an `endpoints` set). @internal
 */
export const selectEndpoint = (
  node: AnyNode,
): { readonly kind: ProtocolKind; readonly url?: string; readonly path?: string } | undefined => {
  const ep: Endpoints | undefined = node.endpoints
  if (ep !== undefined) {
    const order: ReadonlyArray<ProtocolKind> =
      typeof window !== "undefined"
        ? ["WebSocket", "Http", "IpcSocket"]
        : ["Http", "WebSocket", "IpcSocket"]
    for (const k of order) {
      if (k === "Http" && ep.Http !== undefined) {
        return { kind: "Http", url: ep.Http.url }
      }
      if (k === "WebSocket" && ep.WebSocket !== undefined) {
        return { kind: "WebSocket", url: ep.WebSocket.url }
      }
      if (k === "IpcSocket" && ep.IpcSocket !== undefined) {
        return { kind: "IpcSocket", path: ep.IpcSocket.path }
      }
    }
  }
  if (node.kind === undefined) {
    return undefined
  }
  return { kind: node.kind, url: node.url, path: node.path }
}

/** Protocol for any node — invalid target / unaddressed → typed Layer fail. @internal */
export const protocolForNode = (
  node: AnyNode,
): Layer.Layer<RpcClient.Protocol, UnaddressedNode | InvalidHttpTarget> => {
  const invalid = invalidHttpTargetOf(node)
  if (invalid !== undefined) {
    return invalidHttpTargetLayer(invalid)
  }
  const { protocolHttp, protocolWebsocket, protocolIpc } = protocols()
  const sel = selectEndpoint(node)
  if (sel === undefined) {
    return unaddressedLayer(node.key)
  }
  if (sel.kind === "IpcSocket") {
    if (sel.path === undefined) {
      return unaddressedLayer(node.key)
    }
    return protocolIpc(sel.path)
  }
  if (sel.url === undefined) {
    return unaddressedLayer(node.key)
  }
  // A bare-port node dials via `protocolHttp(port)` — the host resolves from the client Config; a full
  // url uses `sel.url` as-is. (`sel.url` is the localhost preview for a bare port.)
  return sel.kind === "WebSocket"
    ? protocolWebsocket(sel.url)
    : protocolHttp(portOf(node) ?? sel.url)
}

/** Protocol for a type-narrowed {@link AddressedNode} — no error channel. @internal */
export const protocolForDialable = (
  node: AddressedNode<unknown>,
): Layer.Layer<RpcClient.Protocol> => {
  const { protocolHttp, protocolWebsocket, protocolIpc } = protocols()
  const sel = selectEndpoint(node)
  if (sel !== undefined) {
    if (sel.kind === "IpcSocket" && sel.path !== undefined) {
      return protocolIpc(sel.path)
    }
    if (sel.kind !== "IpcSocket" && sel.url !== undefined) {
      return sel.kind === "WebSocket"
        ? protocolWebsocket(sel.url)
        : protocolHttp(portOf(node) ?? sel.url)
    }
  }
  // primary fallback — an AddressedNode always carries a dialable primary.
  if (node.kind === "IpcSocket") {
    return protocolIpc(node.path)
  }
  return node.kind === "WebSocket"
    ? protocolWebsocket(node.url)
    : protocolHttp(portOf(node) ?? node.url)
}

/**
 * Canonical derived-connect Layer per Node class — WeakMap so
 * `client(A, W)` + `client(B, W)` + `Node.connect(W)` share one MemoMap entry
 * (and one socket / HTTP client), not one per call site.
 *
 * @internal
 */
const addressedConnectMemo = new WeakMap<object, Layer.Layer<never>>()

/** Derive (and memoize) the connect Layer for an {@link AddressedNode}. @internal */
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
