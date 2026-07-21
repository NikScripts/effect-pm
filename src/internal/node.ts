/**
 * Node dial helpers — connect / clients (no listen / unix / *Server).
 *
 * @internal
 */
import {
  Context,
  Data,
  Effect,
  Function as Fn,
  Layer,
} from "effect"
import {
  RpcClient,
} from "effect/unstable/rpc"
import * as Resource from "../Resource"
import {
  AnyNode,
  catalogSym,
  InvalidHttpTarget,
  isAddressedNode,
  NodeKey,
  UnaddressedNode,
} from "./nodeCore"
import type {
  AddressedNode,
} from "./nodeCore"
import {
  connectAddressed,
  connectLayer,
  protocolForNode,
  unaddressedLayer,
} from "./nodeConnect"
import {
  type CatalogROut,
} from "./nodeListenCommon"

/**
 * Union of Tag `Self` identifiers from a {@link clients} tag list.
 * Shallow {@link Resource.PipeableTag} only — `ResourceTag<…>` here reopens TS2589 under stock tsc.
 *
 * @internal
 */
type ServicesOfTags<Tags extends ReadonlyArray<Resource.PipeableTag>> =
  Tags[number] extends Context.Key<infer S, any> ? S : never;

/** Non-empty tag list for {@link clients}. @internal */
type TagList = readonly [
  Resource.PipeableTag,
  ...ReadonlyArray<Resource.PipeableTag>,
];

/** Tags that cover a catalog node's `ROut` (C3). @internal */
type TagsForCatalog<Node, Tags extends TagList> = [CatalogROut<Node>] extends [
  ServicesOfTags<Tags>,
]
  ? Tags
  : never;

/**
 * {@link clients} got bound tags that do not share one {@link AddressedNode}.
 *
 * @public
 */
export class ClientsNodeMismatch extends Data.TaggedError("ClientsNodeMismatch")<{
  readonly tags: ReadonlyArray<string>;
}> {}

/** Fail a Layer build with {@link ClientsNodeMismatch}. @internal */
const clientsNodeMismatchLayer = (
  tags: ReadonlyArray<string>,
): Layer.Layer<never, ClientsNodeMismatch> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(new ClientsNodeMismatch({ tags })),
      (impossible: never): Layer.Layer<never> => impossible,
    ),
  );

const tagKey = (tag: Resource.PipeableTag): string =>
  typeof tag === "function" && tag !== null && "key" in tag
    ? String((tag as { readonly key: string }).key)
    : "?";

const mergeClientLayers = (
  node: AddressedNode<unknown>,
  tags: ReadonlyArray<Resource.PipeableTag>,
): Layer.Layer<never> => {
  const clients = tags.map((tag) =>
    Resource.client(
      tag as Resource.ResourceTag<any, any>,
      // Keep AddressedNode — drives the auto-connect overload (not bare NodeKey).
      node,
    ),
  );
  return Layer.mergeAll(
    ...(clients as unknown as [
      Layer.Layer<never, never, never>,
      ...Array<Layer.Layer<never, never, never>>,
    ]),
  ) as Layer.Layer<never>;
};

const isTagList = (value: unknown): value is TagList =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (tag) =>
      (typeof tag === "object" || typeof tag === "function") && tag !== null,
  );

const asAddressed = (node: unknown): AddressedNode<unknown> | undefined =>
  isAddressedNode(node as AnyNode) ? (node as AddressedNode<unknown>) : undefined;

const clientsFromBoundTags = (
  tags: ReadonlyArray<Resource.PipeableTag>,
): Layer.Layer<never, UnaddressedNode | ClientsNodeMismatch> => {
  const first = asAddressed(Resource.nodeOf(tags[0]));
  if (first === undefined) {
    return unaddressedLayer(tagKey(tags[0]!));
  }
  for (const tag of tags) {
    if (Resource.nodeOf(tag) !== first) {
      return clientsNodeMismatchLayer(tags.map(tagKey));
    }
  }
  return mergeClientLayers(first, tags);
};

/**
 * Client layers for a catalog node's `ROut` (C2) — one shared {@link connect}, no repeated
 * node on each `client` line.
 *
 * ```ts
 * Node.clients(Worker, [Jobs, Emails])
 * Node.clients(Worker, Jobs, Emails)
 * Node.clients([Jobs, Emails]) // each tag carries Worker via andNode / { node }
 * Node.clients(Jobs, Emails)
 * ```
 *
 * @category connect
 * @public
 */
export function clients<
  Node extends AddressedNode<unknown> & {
    readonly [catalogSym]?: unknown;
  },
  const Tags extends TagList,
>(
  node: Node,
  tags: TagsForCatalog<Node, Tags>,
): Layer.Layer<ServicesOfTags<Tags>>;
export function clients<
  Node extends AddressedNode<unknown> & {
    readonly [catalogSym]?: unknown;
  },
  const Tags extends TagList,
>(
  node: Node,
  ...tags: TagsForCatalog<Node, Tags>
): Layer.Layer<ServicesOfTags<Tags>>;
/** Bound tags — node from each tag's `andNode` / `{ node }` (array form). */
export function clients<const Tags extends TagList>(
  tags: Tags,
): Layer.Layer<ServicesOfTags<Tags>, UnaddressedNode | ClientsNodeMismatch>;
/** Bound tags — rest form. */
export function clients<const Tags extends TagList>(
  ...tags: Tags
): Layer.Layer<ServicesOfTags<Tags>, UnaddressedNode | ClientsNodeMismatch>;
export function clients(
  first: unknown,
  second?: unknown,
  ...rest: ReadonlyArray<unknown>
): Layer.Layer<never, UnaddressedNode | ClientsNodeMismatch> {
  const addressed = asAddressed(first);
  if (addressed !== undefined) {
    const tags: ReadonlyArray<Resource.PipeableTag> = isTagList(second)
      ? second
      : second !== undefined
        ? ([second, ...rest] as unknown as TagList)
        : [];
    return mergeClientLayers(addressed, tags);
  }
  const tags: ReadonlyArray<Resource.PipeableTag> = isTagList(first)
    ? first
    : second !== undefined
      ? ([first, second, ...rest] as unknown as TagList)
      : ([first] as unknown as TagList);
  return clientsFromBoundTags(tags);
}


/**
 * Wire a {@link Node}'s transport — the transport-agnostic primitive, **dual**:
 *
 * ```ts
 * MyNode.pipe(Node.connect)              // derive the transport from the node's declared kind + url
 * MyNode.pipe(Node.connect(protocol))    // data-last: an explicit RpcClient.Protocol
 * Node.connect(MyNode)                   // data-first, derived (needs an AddressedNode)
 * Node.connect(MyNode, protocol)         // data-first, explicit
 * ```
 *
 * The derived forms read the node's {@link ProtocolKind} — so a node that declares `kind: "WebSocket"`
 * dials WS and one that declares `"Http"` dials http; picking the wrong transport isn't
 * expressible. `MyNode.pipe(Node.connect)` only type-checks for an {@link AddressedNode} (a node
 * with both `url`/`path` and `kind`); a bare node is a compile error pointing you to declare its
 * address or pass a protocol.
 *
 * Derived connect Layers are WeakMap-memoized per Node class so multiple
 * `Resource.client(Tag, MyNode)` call sites share one MemoMap transport.
 *
 * @category connect
 * @public
 */
export const connect: {
  // Order matters: TS selects the LAST matching overload when the function is used as a bare value
  // (`node.pipe(connect)`), so the node→Layer form is last to make the pipe form resolve to it; direct
  // calls still match top-down by arg count / shape.
  <Self, RIn>(
    node: NodeKey<Self>,
    protocol: Layer.Layer<RpcClient.Protocol, never, RIn>,
  ): Layer.Layer<Self, never, RIn>;
  <RIn>(
    protocol: Layer.Layer<RpcClient.Protocol, never, RIn>,
  ): <Self>(node: NodeKey<Self>) => Layer.Layer<Self, never, RIn>;
  /** Derived transport — only {@link AddressedNode}; error channel is empty (address proven). */
  <Self>(node: AddressedNode<Self>): Layer.Layer<Self>;
} = Fn.dual(
  // data-first when there are two args, or when the single arg is a node (not a protocol layer).
  (args: IArguments) => args.length >= 2 || !Layer.isLayer(args[0]),
  (
    node: AnyNode,
    protocol?: Layer.Layer<RpcClient.Protocol, never, unknown>,
  ): Layer.Layer<unknown, UnaddressedNode | InvalidHttpTarget, unknown> => {
    if (protocol !== undefined) {
      return connectLayer(node, protocol);
    }
    // Addressed path — canonical memoized Layer (same object Resource.client auto-connect uses).
    if (
      (node.kind === "IpcSocket" && typeof node.path === "string") ||
      ((node.kind === "Http" || node.kind === "WebSocket") &&
        typeof node.url === "string")
    ) {
      return connectAddressed(node as AddressedNode<unknown>);
    }
    return connectLayer(node, protocolForNode(node));
  },
);

/**
 * Wire a node over **http** — Effect's `layerProtocolHttp` transport, {@link connect} pinned to
 * `kind: "Http"`. Dual: `MyNode.pipe(Resource.connectHttp)` uses the node's own `url` (or `"/rpc"`);
 * `MyNode.pipe(Resource.connectHttp(url))` overrides it.
 *
 * @category connect
 * @public
 */
export const connectHttp: {
  // data-last first, node form last — so the bare pipe (`node.pipe(connectHttp)`) resolves to the node
  // overload (TS picks the last for a bare value); `connectHttp(url)` still matches the string overload.
  (url: string): <Self>(node: NodeKey<Self>) => Layer.Layer<Self>;
  <Self>(node: NodeKey<Self> & { readonly url?: string }): Layer.Layer<Self>;
} = Fn.dual(
  (args: IArguments) => typeof args[0] !== "string",
  (
    node: NodeKey<unknown> & { readonly url?: string },
    url?: string,
  ): Layer.Layer<unknown> => connectLayer(node, Resource.protocolHttp(url ?? node.url ?? "/rpc")),
);

/**
 * Wire a node over a **WebSocket** — Effect's `layerProtocolSocket` transport (WS in the
 * browser), {@link connect} pinned to `kind: "WebSocket"`. Dual: `MyNode.pipe(Resource.connectSocket)`
 * uses the node's own `url` (or `"/rpc"`); `MyNode.pipe(Resource.connectSocket(url))` overrides it.
 *
 * @category connect
 * @public
 */
export const connectSocket: {
  // data-last first, node form last — see connectHttp.
  (url: string): <Self>(node: NodeKey<Self>) => Layer.Layer<Self>;
  <Self>(node: NodeKey<Self> & { readonly url?: string }): Layer.Layer<Self>;
} = Fn.dual(
  (args: IArguments) => typeof args[0] !== "string",
  (
    node: NodeKey<unknown> & { readonly url?: string },
    url?: string,
  ): Layer.Layer<unknown> => connectLayer(node, Resource.protocolWebsocket(url ?? node.url ?? "/rpc")),
);

/**
 * Wire a node over **IpcSocket** — Unix-domain socket RPC ({@link protocolIpc}), {@link connect}
 * pinned to `kind: "IpcSocket"`. Dual: `MyNode.pipe(Resource.connectIpc)` uses the node's own `path`;
 * `MyNode.pipe(Resource.connectIpc(path))` overrides it.
 *
 * @category connect
 * @public
 */
export const connectIpc: {
  (path: string): <Self>(node: NodeKey<Self>) => Layer.Layer<Self>;
  <Self>(
    node: NodeKey<Self> & { readonly path?: string },
  ): Layer.Layer<Self, UnaddressedNode>;
} = Fn.dual(
  (args: IArguments) => typeof args[0] !== "string",
  (
    node: NodeKey<unknown> & { readonly path?: string },
    path?: string,
  ): Layer.Layer<unknown, UnaddressedNode> => {
    const sock = path ?? node.path;
    if (sock === undefined) {
      return unaddressedLayer(node.key);
    }
    return connectLayer(node, Resource.protocolIpc(sock));
  },
);

