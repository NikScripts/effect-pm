/**
 * {@link unix} — IpcSocket listen (mint/claim/bind). Lookup via pipe, not options.
 *
 * @internal
 */
import { Clock, Effect, Layer, Option } from "effect"
import * as Hyperlink from "../Hyperlink"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  ListenNode,
  ListenOptions,
  NamelessListenOptions,
  Tag,
  UnaddressedNode,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import { ipcServer } from "./nodeIpcServer"
import {
  failListenTagNode,
  isDynamicInstanceNode,
  isNonIpcNode,
  isPrototypeNode,
  isHyperlinkTagArg,
  isServeArg,
  unixRequiresIpcLayer,
  anonymousNodeKey,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"
import { retype } from "./nodeServerCommon"

/**
 * Unix-domain IPC listen — all ipc mint/bind. **Nameless** `unix([serve…])` / `unix(serve)` Soft-bakes
 * {@link Lookup.layer} (claim + advertise) — override with `Layer.provide(Lookup.layerOptions({ path }))`.
 * Named / address-less `Node.Tag` listens still pipe Lookup when they claim. Protocol listen sibling of
 * {@link http} / {@link ws} / {@link nPipe} / {@link Prototype.listen} — keep in sync. Prefer this for
 * same-machine.
 *
 * @category listen
 * @public
 */
export function unix<
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
  options?: NamelessListenOptions,
): Layer.Layer<Self | Hyperlink.Local<Self> | ListenNode, never, R>;
export function unix<A, E, R>(
  serve: Layer.Layer<A, E, R>,
  options?: NamelessListenOptions,
): Layer.Layer<A | ListenNode, E, R>;
export function unix<const Serves extends ServeLayerList>(
  serves: Serves,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function unix<
  Node extends AnyNode & { readonly [catalogSym]?: unknown },
  const Serves extends ServeLayerList,
>(
  node: Node,
  serves: Serves & ServesForCatalog<CatalogROut<Node>, Serves>,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function unix(
  nodeOrServesOrTag:
    | AnyNode
    | Layer.Any
    | ServeLayerList
    | Hyperlink.PipeableTag,
  servesOrOptionsOrImpl?:
    | Layer.Any
    | ServeLayerList
    | NamelessListenOptions
    | object,
  options?: NamelessListenOptions,
): Layer.Any {
  const listenOptions = (
    isServeArg(nodeOrServesOrTag) ? servesOrOptionsOrImpl : options
  ) as NamelessListenOptions | undefined;
  if (isServeArg(nodeOrServesOrTag)) {
    const list = (
      Array.isArray(nodeOrServesOrTag)
        ? nodeOrServesOrTag
        : [nodeOrServesOrTag]
    ) as ServeLayerList;
    return ipcNameless(list, listenOptions);
  }

  if (isHyperlinkTagArg(nodeOrServesOrTag)) {
    const tag = nodeOrServesOrTag;
    const tagKey = (() => {
      const key = (tag as { readonly key?: unknown }).key;
      return typeof key === "string" ? key : "unknown";
    })();
    const bound = Hyperlink.nodeOf(tag);
    const fleet = Hyperlink.nodesOf(
      tag as Hyperlink.HyperlinkTag<unknown, Hyperlink.Spec>,
    );
    if (bound === undefined) {
      return failListenTagNode({
        tag: tagKey,
        reason: fleet.length > 1 ? "ambiguous" : "missing",
        count: fleet.length,
      });
    }
    if (isNonIpcNode(bound as AnyNode)) {
      const n = bound as AnyNode;
      return unixRequiresIpcLayer(
        n.key,
        n.kind ?? (typeof n.url === "string" ? "url" : "unknown"),
      );
    }
    const serveErased = retype<
      (tag: Hyperlink.PipeableTag, impl: unknown) => Layer.Layer<never, never, never>
    >(Hyperlink.serve as never);
    return ipcListenOn(
      bound as AnyNode,
      [serveErased(tag, servesOrOptionsOrImpl)] as ServeLayerList,
      listenOptions,
    );
  }

  const node = nodeOrServesOrTag as AnyNode;
  if (isNonIpcNode(node)) {
    return unixRequiresIpcLayer(
      node.key,
      node.kind ?? (typeof node.url === "string" ? "url" : "unknown"),
    );
  }

  const serves = servesOrOptionsOrImpl as Layer.Any | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return ipcListenOn(node, list, listenOptions);
}

/**
 * Nameless anonymous ipc Node + bind. Soft-bakes {@link Lookup.layer} when Identity is absent so
 * `Node.unix([serve…])` needs no Lookup pipe; `Layer.provide(Lookup.layerOptions({ path }))` still
 * overrides (Identity already in env → no default bake).
 *
 * @internal
 */
/**
 * Listen-side erase — keeps address/claim errors; public overloads still reify serve-list E/R.
 */
type ListenLayer = Layer.Layer<never, AddressLessClaimLost | UnaddressedNode, never>;

const ipcNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): ListenLayer =>
  retype<ListenLayer>(
    Layer.unwrap(
      Effect.gen(function* () {
        const key = yield* anonymousNodeKey(list);
        const core = ipcListenOn(Tag()(key), list, options);
        const Lookup = yield* Effect.promise(() => import("../Lookup"));
        const identity = yield* Effect.serviceOption(Lookup.Identity);
        if (Option.isSome(identity)) {
          return core;
        }
        return core.pipe(Layer.provide(Lookup.layer));
      }),
    ) as never,
  );

/**
 * Bind ipc for a Node — mint/claim when address-less or dynamic; else {@link ipcServer}.
 *
 * @internal
 */
const ipcListenOn = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): ListenLayer => {
  if (isPrototypeNode(node)) {
    return unaddressedLayer(node.key);
  }
  if (isDynamicInstanceNode(node)) {
    return retype<ListenLayer>(
      Layer.unwrap(
        Effect.gen(function* () {
          const protoKey = dynamicPrototypeKeyOf(node);
          const suffix =
            dynamicInstanceSuffixOf(node) ?? (yield* uniqueInstanceSuffix());
          const wireKey = `${protoKey}#${suffix}`;
          const path = yield* ephemeralIpcPath(wireKey);
          const addressed = Object.assign(Tag()(wireKey, { path }), {
            [catalogSym]: (node as { readonly [catalogSym]?: unknown })[
              catalogSym
            ],
          }) as AnyNode & { readonly key: string };
          return withListenNode(addressed, ipcBind(addressed, list, options));
        }),
      ) as never,
    );
  }
  if (
    node.path === undefined &&
    node.url === undefined &&
    (node.kind === undefined || node.kind === "IpcSocket")
  ) {
    return retype<ListenLayer>(
      Layer.unwrap(
        Effect.gen(function* () {
          const path = yield* ephemeralIpcPath(node.key);
          const addressed = Object.assign(Tag()(node.key, { path }), {
            [catalogSym]: (node as { readonly [catalogSym]?: unknown })[
              catalogSym
            ],
          }) as AnyNode & { readonly key: string };
          const Lookup = yield* Effect.promise(() => import("../Lookup"));
          const identity = yield* Effect.serviceOption(Lookup.Identity);
          if (Option.isNone(identity)) {
            return yield* new Hyperlink.IdentitySelfRequired({ tag: node.key });
          }
          const outcome = yield* identity.value
            .claim(
              new Lookup.ClaimRequest({
                key: node.key,
                nodeKey: node.key,
                kind: "IpcSocket",
                path,
              }),
            )
            .pipe(
              Effect.map((endpoint) => ({ _tag: "Won" as const, endpoint })),
              Effect.catchTag("DuplicateIdentity", (duplicate) =>
                Effect.succeed({
                  _tag: "Lost" as const,
                  original: duplicate.original,
                }),
              ),
            );
          if (outcome._tag === "Lost") {
            return yield* new AddressLessClaimLost({
              node: node.key,
              original: outcome.original,
            });
          }
          return withListenNode(addressed, ipcBind(addressed, list, options));
        }),
      ) as never,
    );
  }
  if (node.kind === "IpcSocket" || typeof node.path === "string") {
    return withListenNode(node, ipcBind(node, list, options));
  }
  return unaddressedLayer(node.key);
};

/** {@link ipcServer} for an addressed ipc node. @internal */
const ipcBind = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): ListenLayer => {
  if (node.path === undefined) {
    return unaddressedLayer(node.key);
  }
  const advertiseNode = node as AnyNode & { readonly key: string };
  const server = retype<
    (serves: ServeLayerList, options: Parameters<typeof ipcServer>[1]) => ListenLayer
  >(ipcServer as never);
  return server(list, {
    path: node.path,
    ...(options?.unlink === undefined ? {} : { unlink: options.unlink }),
    ...(options?.serialization !== undefined
      ? { serialization: options.serialization }
      : {}),
    ...(options?.node !== undefined ? { node: options.node } : {}),
    ...(options?.onConflict !== undefined
      ? { onConflict: options.onConflict }
      : {}),
    advertiseNode,
  });
};


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

/** Mint `prototypeKey#<millis>-<seq>` suffix for {@link Node}.Prototype.instance(). @internal */
const uniqueInstanceSuffix = (): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    dynamicInstanceSeq += 1;
    return `${now}-${dynamicInstanceSeq}`;
  });

/**
 * Ephemeral Unix socket path for address-less {@link unix}.
 * Includes a process-local seq so parallel workers rarely collide on the same ms.
 * @internal
 */
const ephemeralIpcPath = (nodeKey: string): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    dynamicInstanceSeq += 1;
    const safe = nodeKey.replace(/[/\\]/g, "-");
    return `/tmp/hyperlink-ts-${safe}-${now}-${dynamicInstanceSeq}.sock`;
  });
