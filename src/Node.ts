/**
 * **Node** — transport endpoints, catalog listen, and connect helpers.
 *
 * Consume as `import * as Node from "@nikscripts/effect-pm/Node"`.
 *
 * - {@link Tag} — declare a named transport endpoint (`class X extends Node.Tag(…) {}`)
 * - {@link Prototype} — address-less template (`.make` / `.instance` / `.listen`)
 * - {@link Lookup} — Lookup-server Node (`isLookupNode: true`)
 * - {@link listen} / {@link httpServer} / {@link wsServer} / {@link ipcServer} — serve catalogs
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
  UnaddressedNode,
  NodeUnreachable,
} from "./internal/nodeCore"
export type {
  NodeKey,
  ProtocolKind,
  AnyNode,
  AddressedNode,
  CatalogNode,
  DialableTarget,
  ListenOptions,
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
import type { AnyNode, ListenOptions } from "./internal/nodeCore"

/**
 * Sugar: {@link listen} + {@link Lookup.bootstrapDefaultLocal} for same-machine demos.
 *
 * Demo-only typing — catalog proof stays on {@link listen} / {@link clientsFor}.
 *
 * @public
 */
export const listenLocal = (
  node: AnyNode,
  serves: Parameters<typeof listen>[1],
  options?: ListenOptions & {
    readonly lookupPath?: string
    readonly unlinkLookup?: boolean
  },
): Layer.Layer<never, unknown, unknown> => {
  const { lookupPath, unlinkLookup, ...listenOptions } = options ?? {}
  return listen(node, serves, listenOptions).pipe(
    Layer.provide(
      LookupMod.bootstrapDefaultLocal({
        ...(lookupPath !== undefined ? { path: lookupPath } : {}),
        ...(unlinkLookup !== undefined ? { unlink: unlinkLookup } : {}),
      }),
    ),
  ) as Layer.Layer<never, unknown, unknown>
}
