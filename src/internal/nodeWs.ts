/**
 * {@link ws} — local WebSocket listen (mint/claim/bind). Lookup via pipe, not options.
 *
 * @internal
 */
import { Clock, Effect, Layer, Option } from "effect"
import { HttpServer } from "effect/unstable/http"
import * as Hyperlink from "../Hyperlink"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  ListenNode,
  ListenOptions,
  Service as Tag,
  WsListenArg,
  UnaddressedNode,
  WsListenRequiresWs,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import { wsServer } from "./nodeHttpServer"
import {
  anonymousNodeKey,
  coerceWsListenOptions,
  failListenTagNode,
  isDynamicInstanceNode,
  isHyperlinkTagArg,
  isNonWsNode,
  isPrototypeNode,
  isServeArg,
  resolveTagListenTarget,
  serveListFromTagImpl,
  softBakeLookupLayer,
  stampListenUrl,
  withListenNode,
  wsListenUrlFromOptions,
  wsRequiresWsLayer,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"
import { retype } from "./nodeServerCommon"

/**
 * Local WebSocket listen — localhost bind. **Nameless** forms Soft-bake {@link Lookup.layer} when
 * Identity is absent (claim + advertise); override with `Layer.provide(Lookup.layerOptions(…))`.
 *
 * Overload family (keep aligned with {@link unix} / {@link http} / {@link nPipe}):
 * - `ws(tag, impl)` / `ws(tag, impl, address)` — unbound Tag → nameless; bound Tag → that Node
 * - `ws(tag, impl, node)` — named listen without `andNode`
 * - `ws(serve, address?)` / `ws([serve…], address?)` — nameless (brackets optional for one)
 * - `ws(node, serve | [serve…], address?)` — named node + serves
 *
 * Address: `3000` / `":3000"` / `"ws://…"` / `{ port | url | … }`. Prefer this over
 * {@link wsServer} when the battery localhost bind is enough.
 *
 * @category listen
 * @public
 */
export function ws<
  Self,
  S extends Hyperlink.Spec,
  HSelf,
  R = never,
>(
  tag: Hyperlink.NodeBoundTag<Self, S, HSelf>,
  impl:
    | Hyperlink.ImplOf<S>
    | Hyperlink.Driver<S, R>
    | Effect.Effect<
        Hyperlink.ImplOf<S> | Hyperlink.Driver<S, R>,
        never,
        R
      >,
  options?: WsListenArg,
): Layer.Layer<Self | Hyperlink.Local<Self> | ListenNode, never, R>;
export function ws<
  Self,
  S extends Hyperlink.Spec,
  N extends AnyNode,
  R = never,
>(
  tag: Hyperlink.HyperlinkTag<Self, S>,
  impl:
    | Hyperlink.ImplOf<S>
    | Hyperlink.Driver<S, R>
    | Effect.Effect<
        Hyperlink.ImplOf<S> | Hyperlink.Driver<S, R>,
        never,
        R
      >,
  node: N,
): Layer.Layer<Self | Hyperlink.Local<Self> | ListenNode, never, R>;
export function ws<Self, S extends Hyperlink.Spec, R = never>(
  tag: Hyperlink.HyperlinkTag<Self, S>,
  impl:
    | Hyperlink.ImplOf<S>
    | Hyperlink.Driver<S, R>
    | Effect.Effect<
        Hyperlink.ImplOf<S> | Hyperlink.Driver<S, R>,
        never,
        R
      >,
  options?: WsListenArg,
): Layer.Layer<Self | Hyperlink.Local<Self> | ListenNode, never, R>;
export function ws<A, E, R>(
  serve: Layer.Layer<A, E, R>,
  options?: WsListenArg,
): Layer.Layer<A | ListenNode, E, R>;
export function ws<const Serves extends ServeLayerList>(
  serves: Serves,
  options?: WsListenArg,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function ws<Node extends AnyNode, A, E, R>(
  node: Node,
  serve: Layer.Layer<A, E, R>,
  options?: WsListenArg,
): Layer.Layer<A | ListenNode, E, R>;
export function ws<
  Node extends AnyNode & { readonly [catalogSym]?: unknown },
  const Serves extends ServeLayerList,
>(
  node: Node,
  serves: Serves & ServesForCatalog<CatalogROut<Node>, Serves>,
  options?: WsListenArg,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function ws(
  nodeOrServesOrTag:
    | AnyNode
    | Layer.Any
    | ServeLayerList
    | Hyperlink.PipeableTag,
  servesOrOptionsOrImpl?:
    | Layer.Any
    | ServeLayerList
    | WsListenArg
    | AnyNode
    | object,
  options?: WsListenArg | AnyNode,
): Layer.Any {
  if (isServeArg(nodeOrServesOrTag)) {
    const list = (
      Array.isArray(nodeOrServesOrTag)
        ? nodeOrServesOrTag
        : [nodeOrServesOrTag]
    ) as ServeLayerList;
    return wsNameless(
      list,
      coerceWsListenOptions(servesOrOptionsOrImpl as WsListenArg | undefined),
    );
  }

  if (isHyperlinkTagArg(nodeOrServesOrTag)) {
    const tag = nodeOrServesOrTag;
    const resolved = resolveTagListenTarget(tag, options);
    if (resolved._tag === "TagNodeError") {
      return failListenTagNode({
        tag: resolved.tag,
        reason: resolved.reason,
        count: resolved.count,
      });
    }
    const list = serveListFromTagImpl(tag, servesOrOptionsOrImpl);
    const listenOptions = coerceWsListenOptions(
      resolved.addressArg as WsListenArg | undefined,
    );
    if (resolved._tag === "Nameless") {
      return wsNameless(list, listenOptions);
    }
    const node = resolved.node;
    if (isNonWsNode(node)) {
      return wsRequiresWsLayer(
        node.key,
        node.kind ??
          (typeof node.path === "string"
            ? "IpcSocket"
            : typeof node.url === "string"
              ? "url"
              : "unknown"),
      );
    }
    return wsListenOn(node, list, listenOptions);
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
    );
  }

  const serves = servesOrOptionsOrImpl as
    | Layer.Layer<never, never, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return wsListenOn(
    node,
    list,
    coerceWsListenOptions(options as WsListenArg | undefined),
  );
}

/**
 * Listen-side erase — keeps address/claim errors; public overloads still reify serve-list E/R.
 */
type ListenLayer = Layer.Layer<
  never,
  AddressLessClaimLost | UnaddressedNode | WsListenRequiresWs,
  never
>;

/**
 * Nameless anonymous WebSocket Node + bind. Soft-bakes {@link Lookup.layer} when Identity is
 * absent (same as {@link unix} nameless). @internal
 */
const wsNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, never, never> =>
  retype<Layer.Layer<never, never, never>>(
    Layer.unwrap(
      Effect.gen(function* () {
        const key = yield* anonymousNodeKey(list);
        const core = wsListenOn(
          Tag()(key, { kind: "WebSocket" }),
          list,
          options,
        );
        return yield* softBakeLookupLayer(core);
      }),
    ) as never,
  );

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
): ListenLayer => {
  // Nameless / address-less + options.port|url → fixed loopback bind (not ephemeral port 0).
  const addressed = stampListenUrl(
    node,
    wsListenUrlFromOptions(options),
    "WebSocket",
  );
  if (isPrototypeNode(addressed)) {
    return unaddressedLayer(addressed.key);
  }
  if (isDynamicInstanceNode(addressed)) {
    return retype<ListenLayer>(
      Layer.unwrap(
        Effect.gen(function* () {
          const protoKey = dynamicPrototypeKeyOf(addressed);
          const suffix =
            dynamicInstanceSuffixOf(addressed) ?? (yield* uniqueInstanceSuffix());
          const wireKey = `${protoKey}#${suffix}`;
          return ephemeralWsListen(wireKey, list, options, addressed);
        }),
      ) as never,
    );
  }
  if (
    addressed.path === undefined &&
    addressed.url === undefined &&
    (addressed.kind === undefined || addressed.kind === "WebSocket")
  ) {
    return ephemeralWsListen(addressed.key, list, options, addressed, {
      claimIdentity: true,
    });
  }
  if (addressed.kind === "WebSocket" || typeof addressed.url === "string") {
    const port = parseLoopbackWsPort(addressed.url);
    if (port === undefined) {
      return wsRequiresWsLayer(
        addressed.key,
        typeof addressed.url === "string"
          ? `remote:${addressed.url}`
          : "WebSocket",
      );
    }
    return withListenNode(
      addressed,
      wsBind(addressed, list, options).pipe(
        Layer.provide(localhostWsPlatform(port)),
      ),
    );
  }
  return unaddressedLayer(addressed.key);
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
): Layer.Layer<never, never, never> =>
  retype<Layer.Layer<never, never, never>>(
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
              const Identity = yield* Effect.promise(() => import("../Identity"));
              const identity = yield* Effect.serviceOption(Identity.Service);
              if (Option.isNone(identity)) {
                return yield* new Hyperlink.IdentitySelfRequired({ tag: wireKey });
              }
              const outcome = yield* identity.value
                .claim(
                  new Identity.ClaimRequest({
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
    ) as never,
  );

/** {@link wsServer} for an addressed WebSocket node (platform provided by caller). @internal */
const wsBind = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): ListenLayer => {
  if (node.url === undefined) {
    return unaddressedLayer(node.key);
  }
  const advertiseNode = node as AnyNode & { readonly key: string };
  return retype<ListenLayer>(
    wsServer(list, {
      ...(options?.path !== undefined ? { path: options.path } : {}),
      ...(options?.serialization !== undefined
        ? { serialization: options.serialization }
        : {}),
      ...(options?.health !== undefined ? { health: options.health } : {}),
      // Listen node key stamps assume errors / durable node logs (not the reserved status key).
      node: options?.node ?? node.key,
      ...(options?.onConflict !== undefined
        ? { onConflict: options.onConflict }
        : {}),
      ...(options?.assumeToken !== undefined
        ? { assumeToken: options.assumeToken }
        : {}),
      ...(options?.onYield !== undefined ? { onYield: options.onYield } : {}),
      advertiseNode,
    }) as never,
  );
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

/** Daemon-local seq so same-ms dynamic instances get distinct wire keys. @internal */
let dynamicInstanceSeq = 0;

/** Mint `prototypeKey#<millis>-<seq>` suffix. @internal */
const uniqueInstanceSuffix = (): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    dynamicInstanceSeq += 1;
    return `${now}-${dynamicInstanceSeq}`;
  });
