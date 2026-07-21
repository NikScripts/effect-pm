/**
 * {@link unix} — IpcSocket listen + Lookup batteries (mint/claim/bind).
 *
 * @internal
 */
import { Clock, Effect, Layer } from "effect"
import * as Resource from "../Resource"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  ListenNode,
  ListenOptions,
  ListenTagNodeRequired,
  NamelessListenOptions,
  Tag,
  UnaddressedNode,
  UnixListenRequiresIpc,
} from "./nodeCore"
import { unaddressedLayer } from "./nodeConnect"
import { ipcServer } from "./nodeIpcServer"
import {
  failListenTagNode,
  isDynamicInstanceNode,
  isNonIpcNode,
  isPrototypeNode,
  isResourceTagArg,
  isServeArg,
  unixRequiresIpcLayer,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"

/**
 * Unix-domain IPC listen — all ipc mint/bind + default Lookup bootstrap.
 * Same overload shapes as the old multi-protocol `listen`. Prefer this for same-machine.
 *
 * @category listen
 * @public
 */
export function unix<
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
export function unix<Serve extends Layer.Layer<never, any, never>>(
  serve: Serve,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serve> | ListenNode,
  never,
  Layer.Services<Serve>
>;
export function unix<Serves extends ServeLayerList>(
  serves: Serves,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>;
export function unix<
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
export function unix(
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
  | UnixListenRequiresIpc,
  unknown
> {
  const rawOpts = (
    isServeArg(nodeOrServesOrTag) ? servesOrOptionsOrImpl : options
  ) as NamelessListenOptions | undefined;
  const {
    lookupPath,
    unlinkLookup,
    bootstrapLookup = true,
    ...listenOptions
  } = rawOpts ?? {};
  const withLookup = <A, E, R>(
    layer: Layer.Layer<A, E, R>,
  ): Layer.Layer<A, E, R> => {
    if (bootstrapLookup === false) {
      return layer;
    }
    return Layer.unwrap(
      Effect.gen(function* () {
        const Lookup = yield* Effect.promise(() => import("../Lookup"));
        return layer.pipe(
          Layer.provide(
            Lookup.bootstrapDefaultLocal({
              ...(lookupPath !== undefined ? { path: lookupPath } : {}),
              ...(unlinkLookup !== undefined ? { unlink: unlinkLookup } : {}),
            }),
          ),
        );
      }),
    ) as Layer.Layer<A, E, R>;
  };

  if (isServeArg(nodeOrServesOrTag)) {
    const list = (
      Array.isArray(nodeOrServesOrTag)
        ? nodeOrServesOrTag
        : [nodeOrServesOrTag]
    ) as ServeLayerList;
    return withLookup(ipcNameless(list, listenOptions)) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | UnixListenRequiresIpc,
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
        | UnixListenRequiresIpc,
        unknown
      >;
    }
    if (isNonIpcNode(bound as AnyNode)) {
      const n = bound as AnyNode;
      return unixRequiresIpcLayer(
        n.key,
        n.kind ?? (typeof n.url === "string" ? "url" : "unknown"),
      ) as Layer.Layer<
        never,
        | UnaddressedNode
        | AddressLessClaimLost
        | ListenTagNodeRequired
        | UnixListenRequiresIpc,
        unknown
      >;
    }
    const serveErased = Resource.serve as unknown as (
      tag: Resource.PipeableTag,
      impl: unknown,
    ) => Layer.Layer<never, never, never>;
    return withLookup(
      ipcListenOn(
        bound as AnyNode,
        [serveErased(tag, servesOrOptionsOrImpl)] as ServeLayerList,
        listenOptions,
      ),
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | UnixListenRequiresIpc,
      unknown
    >;
  }

  const node = nodeOrServesOrTag as AnyNode;
  if (isNonIpcNode(node)) {
    return unixRequiresIpcLayer(
      node.key,
      node.kind ?? (typeof node.url === "string" ? "url" : "unknown"),
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | UnixListenRequiresIpc,
      unknown
    >;
  }

  const serves = servesOrOptionsOrImpl as
    | Layer.Layer<never, any, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return withLookup(ipcListenOn(node, list, listenOptions)) as Layer.Layer<
    never,
    | UnaddressedNode
    | AddressLessClaimLost
    | ListenTagNodeRequired
    | UnixListenRequiresIpc,
    unknown
  >;
}

/** Nameless anonymous ipc Node + bind (Lookup added by {@link unix}). @internal */
const ipcNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const suffix = yield* uniqueInstanceSuffix();
      const key = `effect-pm/anonymous#${suffix}`;
      return ipcListenOn(Tag(key), list, options);
    }),
  ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;

/**
 * Bind ipc for a Node — mint/claim when address-less or dynamic; else {@link ipcServer}.
 *
 * @internal
 */
const ipcListenOn = (
  node: AnyNode,
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> => {
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
        const path = yield* ephemeralIpcPath(wireKey);
        const addressed = Object.assign(Tag(wireKey, { path }), {
          [catalogSym]: (node as { readonly [catalogSym]?: unknown })[
            catalogSym
          ],
        }) as AnyNode & { readonly key: string };
        return withListenNode(addressed, ipcBind(addressed, list, options));
      }),
    ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;
  }
  if (
    node.path === undefined &&
    node.url === undefined &&
    (node.kind === undefined || node.kind === "IpcSocket")
  ) {
    return Layer.unwrap(
      Effect.gen(function* () {
        const path = yield* ephemeralIpcPath(node.key);
        const addressed = Object.assign(Tag(node.key, { path }), {
          [catalogSym]: (node as { readonly [catalogSym]?: unknown })[
            catalogSym
          ],
        }) as AnyNode & { readonly key: string };
        const Lookup = yield* Effect.promise(() => import("../Lookup"));
        const identity = yield* Lookup.Identity;
        const outcome = yield* identity
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
    ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;
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
): Layer.Layer<never, UnaddressedNode, unknown> => {
  if (node.path === undefined) {
    return unaddressedLayer(node.key);
  }
  const advertiseNode = node as AnyNode & { readonly key: string };
  return ipcServer(list, {
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

/** Process-local seq so same-ms dynamic instances get distinct wire keys. @internal */
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
    return `/tmp/effect-pm-${safe}-${now}-${dynamicInstanceSeq}.sock`;
  });
