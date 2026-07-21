/**
 * Neutral {@link listen} spine — no transport bind; use {@link unix} / {@link http} / {@link ws}.
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
  isWsListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"

/**
 * Neutral catalog spine (C2) — **no transport bind**. Prefer {@link unix} / {@link http} / {@link ws}.
 *
 * **IpcSocket, Http, WebSocket, address-less, nameless, and Tag+impl fail with
 * {@link ListenUseProtocol}** → use the matching protocol entry.
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
  _servesOrImpl?:
    | Layer.Layer<never, any, never>
    | ServeLayerList
    | object,
  _options?: ListenOptions,
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
    if (isWsListenNode(bound as AnyNode)) {
      return failUseProtocol(
        "ws",
        `Tag "${tagKey}" is bound to a WebSocket Node`,
      );
    }
    return failUseProtocol(
      "unix",
      `Tag "${tagKey}" has no protocol-bound Node — use Node.unix / Node.http / Node.ws`,
    );
  }

  const node = nodeOrTag as AnyNode;

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
  if (isWsListenNode(node)) {
    return failUseProtocol("ws", `node "${node.key}" needs WebSocket bind`);
  }
  return failUseProtocol(
    "unix",
    `node "${node.key}" — use Node.unix / Node.http / Node.ws`,
  );
}
