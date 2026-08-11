/**
 * {@link http} — local Http listen (mint/claim/bind). Lookup via pipe, not options.
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
  HttpListenRequiresHttp,
  ListenNode,
  HttpListenArg,
  ListenOptions,
  Service as Tag,
  UnaddressedNode,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import { httpServer } from "./nodeHttpServer"
import {
  dialNodeFromAddress,
  EmptyPrimarySet,
  isAdvertiseDial,
  listenAddressesOfKind,
  UnknownAddressLabel,
  UnixFromKeyBindPending,
} from "./nodeAddressListen"
import { addressesOf } from "./nodeMake"
import {
  anonymousNodeKey,
  coerceHttpListenOptions,
  failLayer,
  failListenTagNode,
  httpListenUrlFromOptions,
  httpRequiresHttpLayer,
  isDynamicInstanceNode,
  isHyperlinkTagArg,
  isNonHttpNode,
  isPrototypeNode,
  isServeArg,
  resolveTagListenTarget,
  serveListFromTagImpl,
  softBakeLookupLayer,
  stampListenUrl,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"
import { mergeServeList, retype } from "./nodeServerCommon"

/** Listen-side erase — keeps address/claim/protocol errors; public overloads reify serve E/R. */
type ListenLayer = Layer.Layer<
  never,
  | AddressLessClaimLost
  | UnaddressedNode
  | HttpListenRequiresHttp
  | EmptyPrimarySet
  | UnknownAddressLabel
  | UnixFromKeyBindPending,
  never
>

/**
 * Local Http listen — localhost bind. **Nameless** forms Soft-bake {@link Lookup.layer} when
 * Identity is absent (claim + advertise); override with `Layer.provide(Lookup.layerOptions(…))`.
 *
 * Overload family (keep aligned with {@link unix} / {@link ws} / {@link nPipe}):
 * - `http(tag, impl)` / `http(tag, impl, address)` — unbound Tag → nameless; bound Tag → that Node
 * - `http(tag, impl, node)` — named listen without `andNode`
 * - `http(serve, address?)` / `http([serve…], address?)` — nameless (brackets optional for one)
 * - `http(node, serve | [serve…], address?)` — named node + serves
 *
 * Address: `3000` / `":3000"` / `"http://…"` / `{ port | url | … }`. Prefer this over
 * {@link httpServer} when the battery localhost bind is enough.
 *
 * @category listen
 * @public
 */
export function http<
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
  options?: HttpListenArg,
): Layer.Layer<Self | Hyperlink.Local<Self> | ListenNode, never, R>;
export function http<
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
export function http<Self, S extends Hyperlink.Spec, R = never>(
  tag: Hyperlink.HyperlinkTag<Self, S>,
  impl:
    | Hyperlink.ImplOf<S>
    | Hyperlink.Driver<S, R>
    | Effect.Effect<
        Hyperlink.ImplOf<S> | Hyperlink.Driver<S, R>,
        never,
        R
      >,
  options?: HttpListenArg,
): Layer.Layer<Self | Hyperlink.Local<Self> | ListenNode, never, R>;
export function http<A, E, R>(
  serve: Layer.Layer<A, E, R>,
  options?: HttpListenArg,
): Layer.Layer<A | ListenNode, E, R>;
export function http<const Serves extends ServeLayerList>(
  serves: Serves,
  options?: HttpListenArg,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function http<Node extends AnyNode, A, E, R>(
  node: Node,
  serve: Layer.Layer<A, E, R>,
  options?: HttpListenArg,
): Layer.Layer<A | ListenNode, E, R>;
export function http<
  Node extends AnyNode & { readonly [catalogSym]?: unknown },
  const Serves extends ServeLayerList,
>(
  node: Node,
  serves: Serves & ServesForCatalog<CatalogROut<Node>, Serves>,
  options?: HttpListenArg,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function http(
  nodeOrServesOrTag:
    | AnyNode
    | Layer.Any
    | ServeLayerList
    | Hyperlink.PipeableTag,
  servesOrOptionsOrImpl?:
    | Layer.Any
    | ServeLayerList
    | HttpListenArg
    | AnyNode
    | object,
  options?: HttpListenArg | AnyNode,
): Layer.Any {
  // Lookup is not baked in — pipe `Layer.provide(Lookup.layer)` (default) or
  // `Lookup.layerOptions({ path })` / `Lookup.client` when claim / advertise needs it.

  if (isServeArg(nodeOrServesOrTag)) {
    const list = (
      Array.isArray(nodeOrServesOrTag)
        ? nodeOrServesOrTag
        : [nodeOrServesOrTag]
    ) as ServeLayerList;
    return httpNameless(
      list,
      coerceHttpListenOptions(servesOrOptionsOrImpl as HttpListenArg | undefined),
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
    const listenOptions = coerceHttpListenOptions(
      resolved.addressArg as HttpListenArg | undefined,
    );
    if (resolved._tag === "Nameless") {
      return httpNameless(list, listenOptions);
    }
    const node = resolved.node;
    if (isNonHttpNode(node)) {
      return httpRequiresHttpLayer(
        node.key,
        node.kind ??
          (typeof node.path === "string"
            ? "IpcSocket"
            : typeof node.url === "string"
              ? "url"
              : "unknown"),
      );
    }
    return httpListenOn(node, list, listenOptions);
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
    );
  }

  const serves = servesOrOptionsOrImpl as
    | Layer.Layer<never, never, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return httpListenOn(
    node,
    list,
    coerceHttpListenOptions(options as HttpListenArg | undefined),
  );
}

/**
 * Nameless anonymous Http Node + bind. Soft-bakes {@link Lookup.layer} when Identity is absent
 * (same as {@link unix} nameless). @internal
 */
const httpNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): ListenLayer =>
  retype<ListenLayer>(
    Layer.unwrap(
      Effect.gen(function* () {
        const key = yield* anonymousNodeKey(list);
        const core = httpListenOn(Tag()(key, { kind: "Http" }), list, options);
        return yield* softBakeLookupLayer(core);
      }),
    ) as never,
  );

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
): ListenLayer => {
  // Made nodes: bind every Http address in the NodePolicy listen set.
  if (
    addressesOf(node) !== undefined &&
    typeof node.key === "string"
  ) {
    try {
      const httpAddrs = listenAddressesOfKind(
        node as AnyNode & { readonly key: string },
        "Http",
      );
      if (httpAddrs !== undefined) {
        if (httpAddrs.length === 0) {
          return httpRequiresHttpLayer(node.key, "listen-set");
        }
        const binds = httpAddrs.map((addr) => {
          const dial = dialNodeFromAddress(node.key, addr);
          const port = parseLoopbackHttpPort(dial.url);
          if (port === undefined) {
            return httpRequiresHttpLayer(
              node.key,
              typeof dial.url === "string" ? `remote:${dial.url}` : "Http",
            );
          }
          const advertise =
            isAdvertiseDial(node as AnyNode & { readonly key: string }, addr)
              ? (dial as AnyNode & { readonly key: string })
              : undefined;
          return withListenNode(
            dial,
            httpBind(dial, list, options, advertise).pipe(
              Layer.provide(localhostHttpPlatform(port)),
            ),
          );
        });
        return retype<ListenLayer>(
          (binds.length === 1
            ? binds[0]!
            : mergeServeList(
                binds as unknown as readonly [
                  Layer.Any,
                  ...ReadonlyArray<Layer.Any>,
                ],
              )) as never,
        );
      }
    } catch (cause) {
      if (
        cause instanceof EmptyPrimarySet ||
        cause instanceof UnknownAddressLabel ||
        cause instanceof UnixFromKeyBindPending
      ) {
        return failLayer(cause);
      }
      throw cause;
    }
  }

  // Nameless / address-less + options.port|url → fixed loopback bind (not ephemeral port 0).
  const addressed = stampListenUrl(
    node,
    httpListenUrlFromOptions(options),
    "Http",
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
          return ephemeralHttpListen(wireKey, list, options, addressed);
        }),
      ) as never,
    );
  }
  if (
    addressed.path === undefined &&
    addressed.url === undefined &&
    (addressed.kind === undefined || addressed.kind === "Http")
  ) {
    return ephemeralHttpListen(addressed.key, list, options, addressed, {
      claimIdentity: true,
    });
  }
  if (addressed.kind === "Http" || typeof addressed.url === "string") {
    const port = parseLoopbackHttpPort(addressed.url);
    if (port === undefined) {
      return httpRequiresHttpLayer(
        addressed.key,
        typeof addressed.url === "string" ? `remote:${addressed.url}` : "Http",
      );
    }
    return withListenNode(
      addressed,
      httpBind(addressed, list, options).pipe(
        Layer.provide(localhostHttpPlatform(port)),
      ),
    );
  }
  return unaddressedLayer(addressed.key);
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
): ListenLayer =>
  retype<ListenLayer>(
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
    ) as never,
  );

/** {@link httpServer} for an addressed Http node (platform provided by caller). @internal */
const httpBind = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
  advertiseNode: (AnyNode & { readonly key: string }) | undefined = node as
    | (AnyNode & { readonly key: string })
    | undefined,
): ListenLayer => {
  if (node.url === undefined) {
    return unaddressedLayer(node.key);
  }
  // Platform HttpServer is provided by the listen caller (localhost bind / NodeHttpServer).
  return retype<ListenLayer>(
    httpServer(list, {
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
      ...(advertiseNode !== undefined ? { advertiseNode } : {}),
    }) as never,
  );
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

/** Daemon-local seq so same-ms dynamic instances get distinct wire keys. @internal */
let dynamicInstanceSeq = 0;

/** Mint `prototypeKey#<millis>-<seq>` suffix. @internal */
const uniqueInstanceSuffix = (): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    dynamicInstanceSeq += 1;
    return `${now}-${dynamicInstanceSeq}`;
  });
