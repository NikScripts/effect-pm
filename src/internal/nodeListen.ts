/**
 * Neutral {@link listen} spine — Http/WS interim only; ipc → {@link unix}.
 *
 * @internal
 */
import { Effect, Layer } from "effect"
import * as Resource from "../Resource"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  ListenNode,
  ListenOptions,
  ListenTagNodeRequired,
  ListenUseProtocol,
  UnaddressedNode,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import {
  failListenTagNode,
  failUseProtocol,
  isDynamicInstanceNode,
  isHttpListenNode,
  isIpcListenNode,
  isPrototypeNode,
  isResourceTagArg,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"
import {
  wsServer,
  type HttpServerOptions,
} from "./nodeHttpServer"

/**
 * Neutral catalog spine (C2) — **no transport bind**. Prefer {@link unix} / `http` / `ws`.
 *
 * Temporary: Http / WebSocket `listen(node, serves)` still dispatches to {@link httpServer} /
 * {@link wsServer} until `Node.http` / `Node.ws` land. **IpcSocket, address-less ipc, nameless,
 * and Tag+impl on an ipc Node fail with {@link ListenUseProtocol}** → use {@link unix}.
 *
 * @public
 */
export function listen<
  Self,
  S extends Resource.Spec,
  HSelf,
  R = never,
>(
  tag: Resource.NodeBoundTag<Self, S, HSelf>,
  impl:
    | Resource.ImplOf<S>
    | Resource.BuiltResource<S, R>
    | Effect.Effect<
        Resource.ImplOf<S> | Resource.BuiltResource<S, R>,
        never,
        R
      >,
  options?: ListenOptions,
): Layer.Layer<Self | Resource.Local<Self> | ListenNode, never, R>;
export function listen<
  Node extends AnyNode & { readonly [catalogSym]?: unknown },
  Serves extends ServeLayerList,
>(
  node: Node,
  serves: Serves & ServesForCatalog<CatalogROut<Node>, Serves>,
  options?: ListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>;
export function listen(
  nodeOrTag: AnyNode | Resource.PipeableTag,
  servesOrImpl?:
    | Layer.Layer<never, any, never>
    | ServeLayerList
    | object,
  options?: ListenOptions,
): Layer.Layer<
  never,
  | UnaddressedNode
  | AddressLessClaimLost
  | ListenTagNodeRequired
  | ListenUseProtocol,
  unknown
> {
  if (isResourceTagArg(nodeOrTag)) {
    const tag = nodeOrTag;
    const tagKey = (() => {
      const key = (tag as unknown as { readonly key?: unknown }).key;
      return typeof key === "string" ? key : "unknown";
    })();
    const bound = Resource.nodeOf(tag);
    const fleet = Resource.nodesOf(
      tag as unknown as Resource.ResourceTag<unknown, Resource.Spec>,
    );
    if (bound === undefined) {
      return failListenTagNode({
        tag: tagKey,
        reason: fleet.length > 1 ? "ambiguous" : "missing",
        count: fleet.length,
      });
    }
    if (isIpcListenNode(bound as AnyNode)) {
      return failUseProtocol(
        "unix",
        `Tag "${tagKey}" is bound to an IpcSocket Node`,
      );
    }
    if (isHttpListenNode(bound as AnyNode)) {
      return failUseProtocol(
        "http",
        `Tag "${tagKey}" is bound to an Http Node`,
      );
    }
    const serveErased = Resource.serve as unknown as (
      tag: Resource.PipeableTag,
      impl: unknown,
    ) => Layer.Layer<never, never, never>;
    return listen(
      bound as AnyNode,
      [serveErased(tag, servesOrImpl)] as ServeLayerList,
      options,
    );
  }

  const node = nodeOrTag as AnyNode;
  const serves = servesOrImpl as
    | Layer.Layer<never, any, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;

  if (isPrototypeNode(node)) {
    return unaddressedLayer(node.key);
  }
  if (isIpcListenNode(node) || isDynamicInstanceNode(node)) {
    return failUseProtocol(
      "unix",
      `node "${node.key}" needs IpcSocket bind`,
    );
  }
  if (isHttpListenNode(node)) {
    return failUseProtocol("http", `node "${node.key}" needs Http bind`);
  }
  // WebSocket only until Node.ws (Phase C).
  return withListenNode(node, wsTransport(node, list, options));
}


/**
 * WebSocket bind for neutral {@link listen} only (Phase B interim).
 * Http is {@link http}; ipc is {@link unix}. @internal
 */
const wsTransport = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode, unknown> => {
  const advertiseNode = node as AnyNode & { readonly key: string };
  const httpOpts: HttpServerOptions | undefined =
    options === undefined
      ? { advertiseNode }
      : {
          ...(options.path !== undefined ? { path: options.path } : {}),
          ...(options.serialization !== undefined
            ? { serialization: options.serialization }
            : {}),
          ...(options.health !== undefined ? { health: options.health } : {}),
          ...(options.node !== undefined ? { node: options.node } : {}),
          advertiseNode,
        };
  if (node.kind === "WebSocket") {
    return wsServer(list, httpOpts);
  }
  return unaddressedLayer(node.key);
};
