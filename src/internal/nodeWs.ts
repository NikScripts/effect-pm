/**
 * {@link ws} — local WebSocket listen (mint/claim/bind). Lookup via pipe, not options.
 *
 * @internal
 */
import { Clock, Effect, Layer } from "effect"
import { HttpServer } from "effect/unstable/http"
import * as Resource from "../Resource"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  WsListenRequiresWs,
  ListenNode,
  ListenOptions,
  ListenTagNodeRequired,
  NamelessListenOptions,
  Tag,
  UnaddressedNode,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import { wsServer } from "./nodeHttpServer"
import {
  failListenTagNode,
  wsRequiresWsLayer,
  isDynamicInstanceNode,
  isNonWsNode,
  isPrototypeNode,
  isResourceTagArg,
  isServeArg,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"

/**
 * Local WebSocket listen — localhost bind. Compose Lookup via
 * `Layer.provide(Lookup.bootstrapDefaultLocal(...))` when claim / advertise needs it.
 * Same overload shapes as {@link unix}. Prefer this for same-machine WebSocket.
 *
 * @category listen
 * @public
 */
export function ws<
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
  options?: NamelessListenOptions,
): Layer.Layer<Self | Resource.Local<Self> | ListenNode, never, R>;
export function ws<Serve extends Layer.Layer<never, any, never>>(
  serve: Serve,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serve> | ListenNode,
  never,
  Layer.Services<Serve>
>;
export function ws<Serves extends ServeLayerList>(
  serves: Serves,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>;
export function ws<
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
>;
export function ws(
  nodeOrServesOrTag:
    | AnyNode
    | Layer.Layer<never, any, never>
    | ServeLayerList
    | Resource.PipeableTag,
  servesOrOptionsOrImpl?:
    | Layer.Layer<never, any, never>
    | ServeLayerList
    | NamelessListenOptions
    | object,
  options?: NamelessListenOptions,
): Layer.Layer<
  never,
  | UnaddressedNode
  | AddressLessClaimLost
  | ListenTagNodeRequired
  | WsListenRequiresWs,
  unknown
> {
  const listenOptions = (
    isServeArg(nodeOrServesOrTag) ? servesOrOptionsOrImpl : options
  ) as NamelessListenOptions | undefined;
  // Lookup is not baked in — pipe `Layer.provide(Lookup.bootstrapDefaultLocal(…))`
  // (or `Lookup.layer` / `Lookup.client`) when claim / advertise needs it.

  if (isServeArg(nodeOrServesOrTag)) {
    const list = (
      Array.isArray(nodeOrServesOrTag)
        ? nodeOrServesOrTag
        : [nodeOrServesOrTag]
    ) as ServeLayerList;
    return wsNameless(list, listenOptions) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | WsListenRequiresWs,
      unknown
    >;
  }

  if (isResourceTagArg(nodeOrServesOrTag)) {
    const tag = nodeOrServesOrTag;
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
      }) as Layer.Layer<
        never,
        | UnaddressedNode
        | AddressLessClaimLost
        | ListenTagNodeRequired
        | WsListenRequiresWs,
        unknown
      >;
    }
    if (isNonWsNode(bound as AnyNode)) {
      const n = bound as AnyNode;
      return wsRequiresWsLayer(
        n.key,
        n.kind ??
          (typeof n.path === "string"
            ? "IpcSocket"
            : typeof n.url === "string"
              ? "url"
              : "unknown"),
      ) as Layer.Layer<
        never,
        | UnaddressedNode
        | AddressLessClaimLost
        | ListenTagNodeRequired
        | WsListenRequiresWs,
        unknown
      >;
    }
    const serveErased = Resource.serve as unknown as (
      tag: Resource.PipeableTag,
      impl: unknown,
    ) => Layer.Layer<never, never, never>;
    return wsListenOn(
      bound as AnyNode,
      [serveErased(tag, servesOrOptionsOrImpl)] as ServeLayerList,
      listenOptions,
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | WsListenRequiresWs,
      unknown
    >;
  }

  const node = nodeOrServesOrTag as AnyNode;
  if (isNonWsNode(node)) {
    return wsRequiresWsLayer(
      node.key,
      node.kind ??
        (typeof node.path === "string"
          ? "IpcSocket"
          : typeof node.url === "string"
            ? "url"
            : "unknown"),
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | WsListenRequiresWs,
      unknown
    >;
  }

  const serves = servesOrOptionsOrImpl as
    | Layer.Layer<never, any, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return wsListenOn(node, list, listenOptions) as Layer.Layer<
    never,
    | UnaddressedNode
    | AddressLessClaimLost
    | ListenTagNodeRequired
    | WsListenRequiresWs,
    unknown
  >;
}

/** Nameless anonymous WebSocket Node + bind (pipe Lookup when needed). @internal */
const wsNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const suffix = yield* uniqueInstanceSuffix();
      const key = `effect-pm/anonymous#${suffix}`;
      return wsListenOn(Tag()(key, { kind: "WebSocket" }), list, options);
    }),
  ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;

/**
 * Bind WebSocket for a Node — mint/claim when address-less or dynamic; else {@link wsServer}
 * on a loopback port.
 *
 * @internal
 */
const wsListenOn = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost | WsListenRequiresWs, unknown> => {
  if (isPrototypeNode(node)) {
    return unaddressedLayer(node.key);
  }
  if (isDynamicInstanceNode(node)) {
    return Layer.unwrap(
      Effect.gen(function* () {
        const protoKey = dynamicPrototypeKeyOf(node);
        const suffix =
          dynamicInstanceSuffixOf(node) ?? (yield* uniqueInstanceSuffix());
        const wireKey = `${protoKey}#${suffix}`;
        return ephemeralWsListen(wireKey, list, options, node);
      }),
    ) as Layer.Layer<
      never,
      UnaddressedNode | AddressLessClaimLost | WsListenRequiresWs,
      unknown
    >;
  }
  if (
    node.path === undefined &&
    node.url === undefined &&
    (node.kind === undefined || node.kind === "WebSocket")
  ) {
    return ephemeralWsListen(node.key, list, options, node, {
      claimIdentity: true,
    });
  }
  if (node.kind === "WebSocket" || typeof node.url === "string") {
    const port = parseLoopbackWsPort(node.url);
    if (port === undefined) {
      return wsRequiresWsLayer(
        node.key,
        typeof node.url === "string" ? `remote:${node.url}` : "WebSocket",
      );
    }
    return withListenNode(
      node,
      wsBind(node, list, options).pipe(Layer.provide(localhostWsPlatform(port))),
    );
  }
  return unaddressedLayer(node.key);
};

/**
 * Ephemeral localhost bind (`port: 0`) → stamp ws url → optional Identity claim → {@link wsServer}.
 * @internal
 */
const ephemeralWsListen = (
  wireKey: string,
  list: ServeLayerList,
  options: ListenOptions | undefined,
  catalogSource: AnyNode,
  claim?: { readonly claimIdentity: true },
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const platform = yield* localhostWsPlatformEffect(0);
      return Layer.unwrap(
        Effect.gen(function* () {
          const server = yield* HttpServer.HttpServer;
          const port =
            server.address._tag === "TcpAddress" ? server.address.port : 0;
          const url = `ws://127.0.0.1:${String(port)}/rpc`;
          const addressed = Object.assign(
            Tag()(wireKey, { url, kind: "WebSocket" as const }),
            {
              [catalogSym]: (
                catalogSource as { readonly [catalogSym]?: unknown }
              )[catalogSym],
            },
          ) as AnyNode & { readonly key: string };
          if (claim?.claimIdentity === true) {
            const Lookup = yield* Effect.promise(() => import("../Lookup"));
            const identity = yield* Lookup.Identity;
            const outcome = yield* identity
              .claim(
                new Lookup.ClaimRequest({
                  key: wireKey,
                  nodeKey: wireKey,
                  kind: "WebSocket",
                  url,
                }),
              )
              .pipe(
                Effect.map((endpoint) => ({
                  _tag: "Won" as const,
                  endpoint,
                })),
                Effect.catchTag("DuplicateIdentity", (duplicate) =>
                  Effect.succeed({
                    _tag: "Lost" as const,
                    original: duplicate.original,
                  }),
                ),
              );
            if (outcome._tag === "Lost") {
              return yield* new AddressLessClaimLost({
                node: wireKey,
                original: outcome.original,
              });
            }
          }
          return withListenNode(
            addressed,
            wsBind(addressed, list, options),
          );
        }),
      ).pipe(Layer.provide(platform));
    }),
  ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;

/** {@link wsServer} for an addressed WebSocket node (platform provided by caller). @internal */
const wsBind = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode, unknown> => {
  if (node.url === undefined) {
    return unaddressedLayer(node.key);
  }
  const advertiseNode = node as AnyNode & { readonly key: string };
  return wsServer(list, {
    ...(options?.path !== undefined ? { path: options.path } : {}),
    ...(options?.serialization !== undefined
      ? { serialization: options.serialization }
      : {}),
    ...(options?.health !== undefined ? { health: options.health } : {}),
    ...(options?.node !== undefined ? { node: options.node } : {}),
    ...(options?.onConflict !== undefined
      ? { onConflict: options.onConflict }
      : {}),
    advertiseNode,
  });
};

/** Loopback port from a `ws://127.0.0.1:N/…` or `ws://localhost:N/…` url. @internal */
const parseLoopbackWsPort = (url: string | undefined): number | undefined => {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // Local batteries are plain ws:// only (no TLS). Escape hatch: wsServer + custom bind.
  if (parsed.protocol !== "ws:") {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "[::1]" &&
    host !== "::1"
  ) {
    return undefined;
  }
  if (parsed.port.length > 0) {
    const n = Number(parsed.port);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return 80;
};

const localhostWsPlatformEffect = (
  port: number,
): Effect.Effect<Layer.Layer<HttpServer.HttpServer>> =>
  Effect.gen(function* () {
    const { NodeHttpServer } = yield* Effect.promise(
      () => import("@effect/platform-node"),
    );
    const { createServer } = yield* Effect.promise(() => import("node:http"));
    return NodeHttpServer.layer(() => createServer(), {
      port,
      host: "127.0.0.1",
    }) as Layer.Layer<HttpServer.HttpServer>;
  });

const localhostWsPlatform = (
  port: number,
): Layer.Layer<HttpServer.HttpServer> =>
  Layer.unwrap(localhostWsPlatformEffect(port));

/** Prototype key stamped by {@link Node}.Prototype.instance. @internal */
const dynamicPrototypeKeyOf = (node: AnyNode): string => {
  const proto = (node as { readonly dynamicPrototypeKey?: string })
    .dynamicPrototypeKey;
  return typeof proto === "string" && proto.length > 0 ? proto : node.key;
};

/** Optional suffix from {@link Node}.Prototype.instance(suffix). @internal */
const dynamicInstanceSuffixOf = (node: AnyNode): string | undefined => {
  const suffix = (node as { readonly instanceSuffix?: string }).instanceSuffix;
  return typeof suffix === "string" && suffix.length > 0 ? suffix : undefined;
};

/** Process-local seq so same-ms dynamic instances get distinct wire keys. @internal */
let dynamicInstanceSeq = 0;

/** Mint `prototypeKey#<millis>-<seq>` suffix. @internal */
const uniqueInstanceSuffix = (): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    dynamicInstanceSeq += 1;
    return `${now}-${dynamicInstanceSeq}`;
  });
