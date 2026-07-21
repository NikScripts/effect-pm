/**
 * **Node** — transport endpoints, catalog listen, and connect helpers.
 *
 * Consume as `import * as Node from "@nikscripts/effect-pm/Node"`.
 *
 * - {@link Tag} — declare a named transport endpoint (`class X extends Node.Tag(…) {}`)
 * - {@link Prototype} — address-less template (`.make` / `.instance` / `.listen`)
 * - {@link Lookup} — Lookup-server Node (`isLookupNode: true`)
 * - {@link listen} — neutral spine (**no transport bind** — use {@link unix} / {@link http} / {@link ws})
 * - {@link unix} — IpcSocket listen + Lookup batteries (nameless / Tag+impl / node+serves)
 * - {@link http} — local Http listen + Lookup batteries (localhost bind / nameless / Tag+impl)
 * - {@link ws} — local WebSocket listen + Lookup batteries (localhost bind / nameless / Tag+impl)
 * - {@link nPipe} — Windows named-pipe IpcSocket listen + Lookup (sibling of {@link unix})
 * - {@link listenLocal} — alias of `unix(node, serves)`
 * - {@link httpServer} / {@link wsServer} / {@link ipcServer} — low-level transport escape hatches
 * - {@link connect} / {@link connectHttp} / {@link connectSocket} / {@link connectIpc} — dial
 * - {@link clients} — bundle clients for a catalog node's `ROut`
 *
 * @module Node
 */
export {
  Tag,
  Lookup,
  isLookupNode,
  isAddressedNode,
  catalogSym,
  resolveOnConflict,
  AddressLessClaimLost,
  ListenNode,
  ListenTagNodeRequired,
  ListenUseProtocol,
  UnixListenRequiresIpc,
  HttpListenRequiresHttp,
  WsListenRequiresWs,
  NPipeListenRequiresIpc,
  NPipeRequiresWindows,
  UnaddressedNode,
  NodeUnreachable,
  ProtocolKindMismatch,
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
  OnConflict,
  OnConflictResolved,
} from "./internal/nodeCore"
export { listen } from "./internal/nodeListen"
export { unix } from "./internal/nodeUnix"
export { http } from "./internal/nodeHttp"
export { ws } from "./internal/nodeWs"
export { nPipe } from "./internal/nodeNPipe"
export { httpServer, wsServer } from "./internal/nodeHttpServer"
export type { HttpServerOptions } from "./internal/nodeHttpServer"
export { ipcServer } from "./internal/nodeIpcServer"
export type { IpcServerOptions } from "./internal/nodeIpcServer"
export { Prototype } from "./internal/nodePrototype"
export {
  clients,
  ClientsNodeMismatch,
  connect,
  connectHttp,
  connectSocket,
  connectIpc,
} from "./internal/node"

import { Layer } from "effect"
import { unix } from "./internal/nodeUnix"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  ListenNode,
  UnaddressedNode,
  UnixListenRequiresIpc,
} from "./internal/nodeCore"
import type { NamelessListenOptions } from "./internal/nodeCore"

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

/**
 * Sugar: {@link unix}`(node, serves)` — IPC listen + Lookup bootstrap.
 * Prefer {@link unix} (also covers Tag+impl and nameless forms).
 *
 * @category listen
 * @public
 */
export function listenLocal<
  Node extends AnyNode & { readonly [catalogSym]?: unknown },
  Serves extends ServeLayerList,
>(
  node: Node,
  serves: Serves & ServesForCatalog<CatalogROut<Node>, Serves>,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>
export function listenLocal(
  node: AnyNode,
  serves: Layer.Layer<never, any, never> | ServeLayerList,
  options?: NamelessListenOptions,
): Layer.Layer<
  never,
  UnaddressedNode | AddressLessClaimLost | UnixListenRequiresIpc,
  unknown
>
export function listenLocal(
  node: AnyNode,
  serves: Layer.Layer<never, any, never> | ServeLayerList,
  options?: NamelessListenOptions,
): Layer.Layer<
  never,
  UnaddressedNode | AddressLessClaimLost | UnixListenRequiresIpc,
  unknown
> {
  return unix(node, serves as ServeLayerList, options)
}
