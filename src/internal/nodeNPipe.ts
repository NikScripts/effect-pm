/**
 * {@link nPipe} — Windows named-pipe IpcSocket listen + Lookup batteries (mint/claim/bind).
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
  NPipeListenRequiresIpc,
  NPipeRequiresWindows,
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
  isResourceTagArg,
  isServeArg,
  nPipeRequiresIpcLayer,
  anonymousNodeKey,
  withListenNode,
  type CatalogROut,
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"

/** Fail closed unless the host is Windows. @internal */
const requireWindows = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
): Layer.Layer<A, E | NPipeRequiresWindows, R> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const os = yield* Effect.promise(() => import("node:os"));
      if (os.platform() !== "win32") {
        return yield* new NPipeRequiresWindows({ platform: os.platform() });
      }
      return layer;
    }),
  ) as Layer.Layer<A, E | NPipeRequiresWindows, R>;

/**
 * Windows named-pipe IPC listen — same overload shapes as {@link unix}.
 * Same `IpcSocket` kind; paths are `\\.\pipe\…`. Prefer {@link unix} on POSIX.
 *
 * @category listen
 * @public
 */
export function nPipe<
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
export function nPipe<Serve extends Layer.Layer<never, any, never>>(
  serve: Serve,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serve> | ListenNode,
  never,
  Layer.Services<Serve>
>;
export function nPipe<Serves extends ServeLayerList>(
  serves: Serves,
  options?: NamelessListenOptions,
): Layer.Layer<
  Layer.Success<Serves[number]> | ListenNode,
  never,
  Layer.Services<Serves[number]>
>;
export function nPipe<
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
export function nPipe(
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
  | NPipeListenRequiresIpc
  | NPipeRequiresWindows,
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
  ): Layer.Layer<A, E | NPipeRequiresWindows, R> => {
    const bootstrapped: Layer.Layer<A, E, R> =
      bootstrapLookup === false
        ? layer
        : (Layer.unwrap(
            Effect.gen(function* () {
              const Lookup = yield* Effect.promise(() => import("../Lookup"));
              return layer.pipe(
                Layer.provide(
                  Lookup.bootstrapDefaultLocal({
                    ...(lookupPath !== undefined ? { path: lookupPath } : {}),
                    ...(unlinkLookup !== undefined
                      ? { unlink: unlinkLookup }
                      : {}),
                  }),
                ),
              );
            }),
          ) as Layer.Layer<A, E, R>);
    return requireWindows(bootstrapped);
  };

  if (isServeArg(nodeOrServesOrTag)) {
    const list = (
      Array.isArray(nodeOrServesOrTag)
        ? nodeOrServesOrTag
        : [nodeOrServesOrTag]
    ) as ServeLayerList;
    return withLookup(nPipeNameless(list, listenOptions)) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | NPipeListenRequiresIpc
      | NPipeRequiresWindows,
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
        | NPipeListenRequiresIpc
  | NPipeRequiresWindows,
        unknown
      >;
    }
    if (isNonIpcNode(bound as AnyNode)) {
      const n = bound as AnyNode;
      return nPipeRequiresIpcLayer(
        n.key,
        n.kind ?? (typeof n.url === "string" ? "url" : "unknown"),
      ) as Layer.Layer<
        never,
        | UnaddressedNode
        | AddressLessClaimLost
        | ListenTagNodeRequired
        | NPipeListenRequiresIpc
  | NPipeRequiresWindows,
        unknown
      >;
    }
    const serveErased = Resource.serve as unknown as (
      tag: Resource.PipeableTag,
      impl: unknown,
    ) => Layer.Layer<never, never, never>;
    return withLookup(
      nPipeListenOn(
        bound as AnyNode,
        [serveErased(tag, servesOrOptionsOrImpl)] as ServeLayerList,
        listenOptions,
      ),
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | NPipeListenRequiresIpc
  | NPipeRequiresWindows,
      unknown
    >;
  }

  const node = nodeOrServesOrTag as AnyNode;
  if (isNonIpcNode(node)) {
    return nPipeRequiresIpcLayer(
      node.key,
      node.kind ?? (typeof node.url === "string" ? "url" : "unknown"),
    ) as Layer.Layer<
      never,
      | UnaddressedNode
      | AddressLessClaimLost
      | ListenTagNodeRequired
      | NPipeListenRequiresIpc
  | NPipeRequiresWindows,
      unknown
    >;
  }

  const serves = servesOrOptionsOrImpl as
    | Layer.Layer<never, any, never>
    | ServeLayerList;
  const list = (Array.isArray(serves) ? serves : [serves]) as ServeLayerList;
  return withLookup(nPipeListenOn(node, list, listenOptions)) as Layer.Layer<
    never,
    | UnaddressedNode
    | AddressLessClaimLost
    | ListenTagNodeRequired
    | NPipeListenRequiresIpc
  | NPipeRequiresWindows,
    unknown
  >;
}

/** Nameless anonymous named-pipe Node + bind (Lookup added by {@link nPipe}). @internal */
const nPipeNameless = (
  list: ServeLayerList,
  options: ListenOptions | undefined,
): Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const key = yield* anonymousNodeKey(list);
      return nPipeListenOn(Tag()(key), list, options);
    }),
  ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;

/**
 * Bind named-pipe ipc for a Node — mint/claim when address-less or dynamic; else {@link ipcServer}.
 *
 * @internal
 */
const nPipeListenOn = (
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
        const path = yield* ephemeralNPipePath(wireKey);
        const addressed = Object.assign(Tag()(wireKey, { path }), {
          [catalogSym]: (node as { readonly [catalogSym]?: unknown })[
            catalogSym
          ],
        }) as AnyNode & { readonly key: string };
        return withListenNode(addressed, nPipeBind(addressed, list, options));
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
        const path = yield* ephemeralNPipePath(node.key);
        const addressed = Object.assign(Tag()(node.key, { path }), {
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
        return withListenNode(addressed, nPipeBind(addressed, list, options));
      }),
    ) as Layer.Layer<never, UnaddressedNode | AddressLessClaimLost, unknown>;
  }
  if (node.kind === "IpcSocket" || typeof node.path === "string") {
    return withListenNode(node, nPipeBind(node, list, options));
  }
  return unaddressedLayer(node.key);
};

/** {@link ipcServer} for an addressed named-pipe node (`unlink` defaults false). @internal */
const nPipeBind = (
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
    // Named pipes are not sock files — default off; caller may still opt in.
    unlink: options?.unlink ?? false,
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
 * Ephemeral Windows named-pipe path for address-less {@link nPipe}.
 * @internal
 */
const ephemeralNPipePath = (nodeKey: string): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    dynamicInstanceSeq += 1;
    const safe = nodeKey.replace(/[/\\:]+/g, "-");
    return `\\\\.\\pipe\\effect-pm-${safe}-${now}-${dynamicInstanceSeq}`;
  });
