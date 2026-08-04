/**
 * **Node** — transport endpoints, catalog listen, and connect helpers.
 *
 * Consume as `import * as Node from "hyperlink-ts/Node"`.
 *
 * - {@link Service} — declare a named transport endpoint (`class X extends Node.Service()(…) {}`)
 * - {@link Prototype} — address-less template (`.make` / `.instance` / `.listen`)
 * - {@link asLookup} — brand a Tag node as the Lookup-server (`isLookupNode: true`)
 * - {@link listen} — neutral spine (**no transport bind** — use {@link unix} / {@link http} / {@link ws})
 * - {@link unix} / {@link http} / {@link ws} / {@link nPipe} — protocol listen **siblings** (keep in sync;
 *   Lookup via pipe — see handoff § Protocol listen siblings)
 * - {@link Prototype}`.listen` — curried dynamic spawn; dispatches to those siblings
 * - {@link listenLocal} — alias of `unix(node, serves)`
 * - {@link httpServer} / {@link wsServer} / {@link ipcServer} — low-level transport escape hatches
 * - {@link connect} / {@link connectHttp} / {@link connectSocket} / {@link connectIpc} — dial
 * - {@link clients} — bundle clients for a catalog node's `ROut`
 * - {@link assume} — launcher ownership ack (`{ token }`) on a running node
 * - {@link drain} — enter intentional cutover drain (`phase: "draining"`; yield refuse)
 * - {@link shutdown} — drain → leave Lookup membership → exit listen scope
 * - {@link launch} — `Layer.launch` raced with shutdown exit (prefer over bare launch)
 *
 * @module Node
 */
export {
  Service,
  withProtocol,
  asLookup,
  isLookupNode,
  isAddressedNode,
  catalogSym,
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
  ProtocolUnanswered,
  ServiceNotServed,
  ServiceNotReady,
  ContractMismatch,
  ProtocolKindMismatch,
  MalformedNode,
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
  HttpListenArg,
  WsListenArg,
  IpcListenArg,
} from "./internal/nodeCore"
export type { OnConflict, OnConflictResolved } from "./Policy"
export { resolveOnConflict } from "./Policy"
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
export type { PrototypeOptions } from "./internal/nodePrototype"
export {
  clients,
  ClientsNodeMismatch,
  connect,
  connectHttp,
  connectSocket,
  connectIpc,
} from "./internal/node"
export {
  AssumeTokenMismatch,
  AssumeTokenReused,
  AssumeNotReady,
} from "./internal/nodeAssume"
export type { NodeOwnership as Ownership } from "./internal/nodeAssume"
export {
  assume,
  assumeTokenConfig,
  ASSUME_TOKEN_ENV as assumeTokenEnv,
} from "./internal/nodeAssumeClient"
export { drain } from "./internal/nodeDrainClient"
export { shutdown } from "./internal/nodeShutdownClient"
export { launch } from "./internal/nodeLaunch"

import { Layer } from "effect"
import { unix } from "./internal/nodeUnix"
import {
  AnyNode,
  catalogSym,
  ListenNode,
} from "./internal/nodeCore"
import type { IpcListenArg } from "./internal/nodeCore"

/** Non-empty serve list — same open-`R` constraint as {@link listen}. */
type ServeLayerList = readonly [Layer.Any, ...ReadonlyArray<Layer.Any>]

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
 * Sugar: {@link unix}`(node, serves)` — IPC listen (pipe Lookup when needed).
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
  options?: IpcListenArg,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>
export function listenLocal(
  node: AnyNode,
  serves: Layer.Any | ServeLayerList,
  options?: IpcListenArg,
): Layer.Any {
  return unix(node, serves as ServeLayerList, options)
}

// ── Node status ──
// Every node auto-serves its status/logs/ping; you read them straight off a connected node handle
// (`const n = yield* MyNode; yield* n.ping` / `n.status.get` / `n.logs.stream`). The engine is a lazy
// internal (pulled only on connect, off the light Tag path). These are the light snapshot types.

/** A node's live status snapshot — what `(yield* MyNode).status.get` resolves to. @category services @public */
export type { NodeStatus as Status } from "./internal/nodeStatus"
/** Lifecycle phase on {@link Status} — `running` | `draining`. @category services @public */
export type { NodePhase as Phase } from "./internal/nodeStatus"
/** One served HyperService's readiness — an element of {@link Status}`.services`. @category services @public */
export type { ServiceReadiness } from "./internal/nodeStatus"
/** The {@link ServiceReadiness} wire schema (for composing your own health surfaces). @category services @public */
export { serviceReadiness } from "./internal/nodeStatus"
