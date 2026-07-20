/**
 * **Node** — transport endpoints, catalog listen, and connect helpers.
 *
 * Consume as `import * as Node from "@nikscripts/effect-pm/Node"`.
 *
 * - {@link Tag} — declare a named transport endpoint (`class X extends Node.Tag(…) {}`)
 * - {@link Prototype} — address-less template (`.make` / `.instance` / `.listen`)
 * - {@link Lookup} — Lookup-server Node (`isLookupNode: true`)
 * - {@link listen} / {@link listenLocal} / {@link httpServer} / {@link wsServer} / {@link ipcServer} — serve catalogs (incl. `listen(Tag, impl)` when Tag carries a sole Node; nameless `listen([serve…])`)
 * - {@link connect} / {@link connectHttp} / {@link connectSocket} / {@link connectIpc} — dial
 * - {@link clientsFor} — bundle clients for a catalog node's `ROut`
 *
 * @module Node
 */
export {
  Tag,
  Lookup,
  isLookupNode,
  isAddressedNode,
  catalogSym,
  AddressLessClaimLost,
  ListenNode,
  ListenTagNodeRequired,
  UnaddressedNode,
  NodeUnreachable,
  InvalidHttpTarget,
} from "./internal/nodeCore"
export type {
  NodeKey,
  ProtocolKind,
  AnyNode,
  AddressedNode,
  CatalogNode,
  DialableTarget,
  ListenOptions,
  NamelessListenOptions,
} from "./internal/nodeCore"
export {
  Prototype,
  listen,
  httpServer,
  wsServer,
  ipcServer,
  clientsFor,
  connect,
  connectHttp,
  connectSocket,
  connectIpc,
} from "./internal/node"
export type { HttpServerOptions, IpcServerOptions } from "./internal/node"

import { Layer } from "effect"
import * as LookupMod from "./Lookup"
import { listen } from "./internal/node"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  ListenNode,
  UnaddressedNode,
} from "./internal/nodeCore"
import type { ListenOptions } from "./internal/nodeCore"

/** Non-empty serve list — same constraint as {@link listen}. */
type ServeLayerList = readonly [
  Layer.Layer<never, any, never>,
  ...ReadonlyArray<Layer.Layer<never, any, never>>,
]

/** C3 catalog proof — every `ROut` member appears in merged serve success. */
type ServesForCatalog<ROut, Serves extends ServeLayerList> = [ROut] extends [
  never,
]
  ? Serves
  : [ROut] extends [Layer.Success<Serves[number]>]
    ? Serves
    : never

type CatalogROut<Node> = Node extends { readonly [catalogSym]?: infer R }
  ? Exclude<R, undefined>
  : never

type ListenLocalOptions = ListenOptions & {
  readonly lookupPath?: string
  readonly unlinkLookup?: boolean
}

/**
 * Sugar: {@link listen} + {@link Lookup.bootstrapDefaultLocal} for same-machine demos.
 * Same catalog proof as {@link listen} — serve list must cover the node's `ROut`.
 *
 * @public
 */
export function listenLocal<
  Node extends AnyNode & { readonly [catalogSym]?: unknown },
  Serves extends ServeLayerList,
>(
  node: Node,
  serves: Serves & ServesForCatalog<CatalogROut<Node>, Serves>,
  options?: ListenLocalOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>
export function listenLocal(
  node: AnyNode,
  serves: Layer.Layer<never, any, never> | ServeLayerList,
  options?: ListenLocalOptions,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>
export function listenLocal(
  node: AnyNode,
  serves: Layer.Layer<never, any, never> | ServeLayerList,
  options?: ListenLocalOptions,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> {
  const { lookupPath, unlinkLookup, ...listenOptions } = options ?? {}
  const list = (
    Array.isArray(serves) ? serves : [serves]
  ) as ServeLayerList
  return listen(node, list, listenOptions).pipe(
    Layer.provide(
      LookupMod.bootstrapDefaultLocal({
        ...(lookupPath !== undefined ? { path: lookupPath } : {}),
        ...(unlinkLookup !== undefined ? { unlink: unlinkLookup } : {}),
      }),
    ),
  )
}
