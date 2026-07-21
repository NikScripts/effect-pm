/**
 * {@link http} — local Http listen (mint/claim/bind). Lookup via pipe, not options.
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
  HttpListenRequiresHttp,
  ListenNode,
  ListenOptions,
  ListenTagNodeRequired,
  NamelessListenOptions,
  Tag,
  UnaddressedNode,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import { httpServer } from "./nodeHttpServer"
import {
  failListenTagNode,
  httpRequiresHttpLayer,
  isDynamicInstanceNode,
  isNonHttpNode,
  isPrototypeNode,
  isResourceTagArg,
  isServeArg,
  anonymousNodeKey,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"

/**
 * Local Http listen — localhost bind. Compose Lookup via
 * `Layer.provide(Lookup.bootstrapDefaultLocal(...))` when claim / advertise needs it.
 * Same overload shapes as {@link unix}. Prefer this for same-machine HTTP.
 *
 * @category listen
 * @public
 */
export function http<
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
export function http<Serve extends Layer.Layer<never, any, never>>(
  serve: Serve,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serve> | ListenNode,
  never,
  Layer.Services<Serve>
>;
export function http<Serves extends ServeLayerList>(
  serves: Serves,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>;
export function http<
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
export function http(
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
  | HttpListenRequiresHttp,
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
    return httpNameless(list, listenOptions) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | HttpListenRequiresHttp,
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
        | HttpListenRequiresHttp,
        unknown
      >;
    }
    if (isNonHttpNode(bound as AnyNode)) {
      const n = bound as AnyNode;
      return httpRequiresHttpLayer(
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
        | HttpListenRequiresHttp,
        unknown
      >;
    }
    const serveErased = Resource.serve as unknown as (
      tag: Resource.PipeableTag,
      impl: unknown,
    ) => Layer.Layer<never, never, never>;
    return httpListenOn(
      bound as AnyNode,
      [serveErased(tag, servesOrOptionsOrImpl)] as ServeLayerList,
      listenOptions,
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | HttpListenRequiresHttp,
      unknown
    >;
  }

  const node = nodeOrServesOrTag as AnyNode;
  if (isNonHttpNode(node)) {
    return httpRequiresHttpLayer(
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
      | HttpListenRequiresHttp,
      unknown
    >;
  }

  const serves = servesOrOptionsOrImpl as
    | Layer.Layer<never, any, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return httpListenOn(node, list, listenOptions) as Layer.Layer<
    never,
    | UnaddressedNode
    | AddressLessClaimLost
    | ListenTagNodeRequired
    | HttpListenRequiresHttp,
    unknown
  >;
}

/** Nameless anonymous Http Node + bind (pipe Lookup when needed). @internal */
const httpNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const key = yield* anonymousNodeKey(list);
      return httpListenOn(Tag()(key, { kind: "Http" }), list, options);
    }),
  ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;

/**
 * Bind Http for a Node — mint/claim when address-less or dynamic; else {@link httpServer}
 * on a loopback port.
 *
 * @internal
 */
const httpListenOn = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost | HttpListenRequiresHttp, unknown> => {
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
        return ephemeralHttpListen(wireKey, list, options, node);
      }),
    ) as Layer.Layer<
      never,
      UnaddressedNode | AddressLessClaimLost | HttpListenRequiresHttp,
      unknown
    >;
  }
  if (
    node.path === undefined &&
    node.url === undefined &&
    (node.kind === undefined || node.kind === "Http")
  ) {
    return ephemeralHttpListen(node.key, list, options, node, {
      claimIdentity: true,
    });
  }
  if (node.kind === "Http" || typeof node.url === "string") {
    const port = parseLoopbackHttpPort(node.url);
    if (port === undefined) {
      return httpRequiresHttpLayer(
        node.key,
        typeof node.url === "string" ? `remote:${node.url}` : "Http",
      );
    }
    return withListenNode(
      node,
      httpBind(node, list, options).pipe(Layer.provide(localhostHttpPlatform(port))),
    );
  }
  return unaddressedLayer(node.key);
};

/**
 * Ephemeral localhost bind (`port: 0`) → stamp url → optional Identity claim → {@link httpServer}.
 * @internal
 */
const ephemeralHttpListen = (
  wireKey: string,
  list: ServeLayerList,
  options: ListenOptions | undefined,
  catalogSource: AnyNode,
  claim?: { readonly claimIdentity: true },
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const platform = yield* localhostHttpPlatformEffect(0);
      return Layer.unwrap(
        Effect.gen(function* () {
          const server = yield* HttpServer.HttpServer;
          const port =
            server.address._tag === "TcpAddress" ? server.address.port : 0;
          const url = `http://127.0.0.1:${String(port)}/rpc`;
          const addressed = Object.assign(
            Tag()(wireKey, { url, kind: "Http" as const }),
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
                  kind: "Http",
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
            httpBind(addressed, list, options),
          );
        }),
      ).pipe(Layer.provide(platform));
    }),
  ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;

/** {@link httpServer} for an addressed Http node (platform provided by caller). @internal */
const httpBind = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode, unknown> => {
  if (node.url === undefined) {
    return unaddressedLayer(node.key);
  }
  const advertiseNode = node as AnyNode & { readonly key: string };
  return httpServer(list, {
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

/** Loopback port from an `http://127.0.0.1:N/…` or `http://localhost:N/…` url. @internal */
const parseLoopbackHttpPort = (url: string | undefined): number | undefined => {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // Local batteries are plain HTTP only (no TLS). Escape hatch: httpServer + custom bind.
  if (parsed.protocol !== "http:") {
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

const localhostHttpPlatformEffect = (
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

const localhostHttpPlatform = (
  port: number,
): Layer.Layer<HttpServer.HttpServer> =>
  Layer.unwrap(localhostHttpPlatformEffect(port));

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
