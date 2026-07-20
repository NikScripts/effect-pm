/**
 * Node runtime — listen / *Server / connect / Prototype / clientsFor.
 * Imports Resource for serve-registry + protocol helpers; only call Resource APIs
 * inside functions where needed (avoid top-level Resource init cycles beyond imports).
 *
 * @internal
 */
import {
  Clock,
  Context,
  Effect,
  Function as Fn,
  Layer,
} from "effect"
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http"
import {
  RpcClient,
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc"
import { unlinkBestEffort } from "./ipcPath"
import * as Resource from "../Resource"
import {
  AddressLessClaimLost,
  AnyNode,
  catalogSym,
  InvalidHttpTarget,
  ListenNode,
  ListenOptions,
  ListenTagNodeRequired,
  ListenUseProtocol,
  NamelessListenOptions,
  NodeKey,
  ProtocolKind,
  ProtocolKindMismatch,
  Tag,
  UnaddressedNode,
  UnixListenRequiresIpc,
} from "./nodeCore"
import type {
  AddressedNode,
  HttpNodeTagClass,
  IpcNodeTagClass,
  UrlNodeTagClass,
  WsNodeTagClass,
} from "./nodeCore"
import {
  connectAddressed,
  connectLayer,
  protocolForNode,
  unaddressedLayer,
} from "./nodeConnect"

/** Options for {@link httpServer}. @public */
export interface HttpServerOptions {
  readonly path?: HttpRouter.PathInput;
  readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  readonly health?: { readonly path?: HttpRouter.PathInput };
  /**
   * Node log key for auto-mounted {@link NodeStatus} durable `logs.query`
   * (`Resource.store(Node)` / `Node.logs`). When omitted, inferred from served tags'
   * bound {@link Node} when all share one key.
   */
  readonly node?: string | { readonly key: string };
  /**
   * Soft Lookup directory advertise after serve registration (`Resource.listen` only).
   *
   * @internal
   */
  readonly advertiseNode?: AnyNode & { readonly key: string };
}

/** A server RPC-protocol builder — {@link Resource.serverProtocolHttp} or {@link Resource.serverProtocolWebsocket}. */
type ServerProtocol = (
  path: HttpRouter.PathInput,
) => Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter>


/** Refuse to boot if any node-bound served resource declares a transport (`nodeKind`) other than the
 *  transport this server actually speaks. A client derives its transport from the node's `kind`, so a
 *  mismatch means every client dials a protocol the server never answers — the silent "blank
 *  dashboard" failure, made loud at boot. Nodeless resources (no `nodeKind`) are unconstrained. */
const assertProtocolKinds = (
  entries: ReadonlyArray<Resource.ServedResource>,
  serverKind: ProtocolKind,
): Effect.Effect<void> =>
  Effect.forEach(
    entries,
    (entry) =>
      entry.nodeKind !== undefined && entry.nodeKind !== serverKind
        ? Effect.die(
            new ProtocolKindMismatch({
              resource: entry.groupId,
              declared: entry.nodeKind,
              servedOver: serverKind,
            }),
          )
        : Effect.void,
    { discard: true },
  )

const httpServerBase = (
  serverProtocol: ServerProtocol,
  serverKind: ProtocolKind,
  options?: HttpServerOptions,
): Layer.Layer<never, never, Resource.ServedResources | HttpServer.HttpServer> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registry = yield* Resource.ServedResources;
      const entries = yield* registry.all;
      if (entries.length === 0) {
        return yield* Effect.die(
          new Error(
            "Node.httpServer: no resources registered — provideMerge at least one Resource.serve(...) layer",
          ),
        );
      }
      yield* assertProtocolKinds(entries, serverKind);
      const startedAt = yield* Clock.currentTimeMillis;
      const readiness = Effect.forEach(entries, (entry) =>
        Effect.map(entry.readiness, (result) => ({
          key: entry.groupId,
          kind: entry.kind,
          ready: result.ready,
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
        })),
      );
      const optionNodeKey =
        options?.node === undefined
          ? undefined
          : typeof options.node === "string"
            ? options.node
            : options.node.key;
      const boundKeys = [
        ...new Set(
          entries.flatMap((entry) =>
            entry.nodeLogKey === undefined ? [] : [entry.nodeLogKey],
          ),
        ),
      ];
      const inferredNodeKey =
        optionNodeKey ?? (boundKeys.length === 1 ? boundKeys[0] : undefined);
      // Every node auto-serves the reserved node-status resource (status / logs / ping) alongside the
      // registered resources, so a client can inspect any node without the author wiring it. Built here
      // (not a registered `serve` layer) so it reports the user resources without counting itself.
      const { nodeStatusServeEntry } = yield* Effect.promise(
        () => import("./nodeStatusResource"),
      );
      const nodeEntry = nodeStatusServeEntry({
        startedAt,
        resourceCount: entries.length,
        readiness,
        ...(inferredNodeKey !== undefined ? { nodeLogKey: inferredNodeKey } : {}),
      });
      const nodeTag = nodeEntry.tag;
      const nodeImpl = (yield* (Effect.isEffect(nodeEntry.impl)
        ? nodeEntry.impl
        : Effect.succeed(nodeEntry.impl))) as Record<string, unknown>;
      const nodeFlat = Resource.flattenImpl(nodeImpl, nodeTag[Resource.specSym]);
      const nodeHandlers: Record<string, (payload: unknown) => unknown> = {};
      for (const [key, member] of Object.entries(nodeFlat)) {
        nodeHandlers[Resource.wireTag(nodeTag.groupId, key)] = (payload) =>
          Resource.invokeWireMethod(member, nodeTag[Resource.specSym][key] as Resource.AnyMethod, payload);
      }
      const merged = [...entries.map((entry) => entry.group), nodeTag[Resource.groupSym]].reduce(
        (acc, group) => acc.merge(group),
      );
      // Transport-agnostic server: `RpcServer.layer` requires the `RpcServer.Protocol` dependency;
      // `serverProtocol` (http for {@link httpServer}, websocket for {@link wsServer}) provides it — an
      // http POST handler or a ws upgrade — on the same router (`HttpRouter.serve` below).
      const rpcAppLayer = RpcServer.layer(merged).pipe(
        Layer.provide(
          nodeTag[Resource.groupSym].toLayer(
            nodeHandlers as unknown as Parameters<
              (typeof nodeTag)[typeof Resource.groupSym]["toLayer"]
            >[0],
          ),
        ),
        Layer.provide(serverProtocol(options?.path ?? "/rpc")),
      );
      const healthRoute = HttpRouter.add(
        "GET",
        options?.health?.path ?? "/health",
        Effect.gen(function* () {
          const ts = yield* Clock.currentTimeMillis;
          const resources = yield* readiness;
          const ok = resources.every((resource) => resource.ready);
          return yield* HttpServerResponse.json({
            status: ok ? "ok" : "degraded",
            listening: true,
            resources,
            uptimeMillis: ts - startedAt,
            ts,
          }).pipe(
            Effect.map((response) => HttpServerResponse.setStatus(response, ok ? 200 : 503)),
            Effect.orDie,
          );
        }),
      );
      const served = HttpRouter.serve(Layer.merge(rpcAppLayer, healthRoute)).pipe(
        Layer.provideMerge(options?.serialization ?? Resource.defaultSerialization),
      );
      const advertise = yield* directoryAdvertiseMerge(
        options?.advertiseNode,
        entries,
      );
      return served.pipe(Layer.provideMerge(advertise));
    }),
  ) as unknown as Layer.Layer<never, never, Resource.ServedResources | HttpServer.HttpServer>;

/**
 * Soft Lookup directory advertise layer after serve registration (`listen` via `advertiseNode`).
 * @internal
 */
const directoryAdvertiseMerge = (
  advertiseNode: (AnyNode & { readonly key: string }) | undefined,
  entries: ReadonlyArray<Resource.ServedResource>,
): Effect.Effect<Layer.Layer<never>> => {
  if (advertiseNode === undefined) {
    return Effect.succeed(Layer.empty);
  }
  const serves = entries.map((entry) => entry.groupId);
  return Effect.map(
    Effect.promise(() => import("../Lookup")),
    (Lookup) =>
      Lookup.directoryAdvertiseLayer(advertiseNode, serves) as Layer.Layer<never>,
  );
};

/**
 * Non-empty serve list for {@link httpServer} / {@link wsServer} / {@link ipcServer}.
 * Bounds match Effect's {@link Layer.mergeAll}: `ROut` is contravariant so `Layer<never, …>`
 * accepts any success; `R` stays open so callers can still provide deps outside the server.
 *
 * @internal
 */
type ServerServeList = readonly [
  Layer.Layer<never, any, any>,
  ...ReadonlyArray<Layer.Layer<never, any, any>>,
]

/** Merge a non-empty serve list — Effect's {@link Layer.mergeAll}, not a hand-rolled `any` fold. */
const mergeServeList = (
  layers: ServerServeList,
): Layer.Layer<
  Layer.Success<ServerServeList[number]>,
  Layer.Error<ServerServeList[number]>,
  Layer.Services<ServerServeList[number]>
> => Layer.mergeAll(...layers)

/**
 * The shared http server for resources composed with {@link serve} — the multi-resource,
 * heterogeneous-dependency counterpart to a single {@link serve} layer. Reads the
 * {@link ServedResources} registry, merges every registered group onto **one** `RpcServer` at `path`
 * (default `/rpc`), and mounts a `/health` route aggregating each resource's readiness. Because each
 * `serve` layer carries **its own** `Layer.provide`d dependency, resources needing different
 * implementations of the same tag stay isolated — no shared union-provide.
 *
 * Pass the `serve` layers as the first argument (recommended) — it bundles the `provideMerge` +
 * {@link Resource.servedResourcesLayer}, so you list resources and provide only the platform (and any shared
 * dependency):
 *
 * ```ts
 * const Node = Resource.httpServer([
 *   // homogeneous majority — one shared dependency, stated once
 *   Resource.provide(ImportHandlers.plain, [
 *     Resource.serve(SeasonMatches, seasonMatchesImpl),
 *     Resource.serve(LiveScorePoller, pollerImpl),
 *   ]),
 *   // outlier — private dependency, isolated on its own serve layer
 *   Resource.serve(SeasonImport, importImpl).pipe(Layer.provide(ImportHandlers.hooked)),
 * ], { health: { path: "/health" } }).pipe(
 *   Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
 * );
 * ```
 *
 * Prefer this shape over rewriting around a retired bag API: one {@link httpServer}, mixed
 * shared + isolated deps, no second port.
 *
 * The low-level `httpServer(options)` form requires you to `Layer.provideMerge` the `serve` layers (kept,
 * not pruned) + {@link Resource.servedResourcesLayer} yourself. Either way the handlers ride the context the
 * `serve` layers provide; if one is missing the `RpcServer` fails at **build** (a clear boot error), never
 * a silent runtime gap.
 *
 * @public
 */
export function httpServer<Serve extends Layer.Layer<never, any, any>>(
  serve: Serve,
  options?: HttpServerOptions,
): Layer.Layer<
  Layer.Success<Serve>,
  Layer.Error<Serve>,
  Layer.Services<Serve> | HttpServer.HttpServer
>;
export function httpServer(
  options?: HttpServerOptions,
): Layer.Layer<never, never, Resource.ServedResources | HttpServer.HttpServer>;
export function httpServer<Serves extends ServerServeList>(
  serves: Serves,
  options?: HttpServerOptions,
): Layer.Layer<
  Layer.Success<Serves[number]>,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]> | HttpServer.HttpServer
>;
export function httpServer(
  servesOrOptions?:
    | Layer.Layer<never, any, any>
    | ServerServeList
    | ReadonlyArray<Layer.Layer<never, any, any>>
    | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Layer<never, any, unknown> {
  return serverImpl(Resource.serverProtocolHttp, "Http", servesOrOptions, maybeOptions);
}

// Shared body for {@link httpServer} / {@link wsServer} — identical wiring, differing only in the
// server RPC protocol. The serves form bundles the boilerplate: provideMerge the serve layers (kept,
// not pruned) + the shared registry, so the caller lists resources and provides only the platform (+
// any shared dep). One serve layer or many — a single `Layer` is treated as a one-element list.
function serverImpl(
  serverProtocol: ServerProtocol,
  serverKind: ProtocolKind,
  servesOrOptions?:
    | Layer.Layer<never, any, any>
    | ServerServeList
    | ReadonlyArray<Layer.Layer<never, any, any>>
    | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Layer<never, any, unknown> {
  const serves = Array.isArray(servesOrOptions)
    ? (servesOrOptions as unknown as ServerServeList)
    : Layer.isLayer(servesOrOptions)
      ? ([servesOrOptions] as unknown as ServerServeList)
      : undefined;
  if (serves !== undefined) {
    return httpServerBase(serverProtocol, serverKind, maybeOptions).pipe(
      Layer.provideMerge(mergeServeList(serves)),
      Layer.provide(Layer.fresh(Resource.servedResourcesLayer)),
    );
  }
  return httpServerBase(
    serverProtocol,
    serverKind,
    servesOrOptions as HttpServerOptions | undefined,
  );
}

/**
 * A **WebSocket** RPC server — the {@link httpServer} sibling for the browser. Everything a client
 * subscribes to (each resource's `status` + `metrics` + `logs`) rides **one multiplexed WebSocket per
 * client**, so a dashboard never trips the browser's ~6-connection-per-origin HTTP/1.1 cap that
 * starves streams over plain HTTP. Identical to {@link httpServer} in every other way — same serve
 * list, same options, same `/health` — it just speaks WebSocket instead of HTTP POST. Clients connect
 * with {@link socketClient} (or `Resource.layerProtocol(Resource.protocolWebsocket())`); a fleet whose
 * peers also serve over this should add `Resource.layerPeerProtocol(Resource.protocolWebsocket)`.
 *
 * ```ts
 * const Node = Resource.wsServer([Resource.serve(Jobs, jobsImpl)]).pipe(
 *   Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
 * );
 * ```
 *
 * @public
 */
export function wsServer<Serve extends Layer.Layer<never, any, any>>(
  serve: Serve,
  options?: HttpServerOptions,
): Layer.Layer<
  Layer.Success<Serve>,
  Layer.Error<Serve>,
  Layer.Services<Serve> | HttpServer.HttpServer
>;
export function wsServer(
  options?: HttpServerOptions,
): Layer.Layer<never, never, Resource.ServedResources | HttpServer.HttpServer>;
export function wsServer<Serves extends ServerServeList>(
  serves: Serves,
  options?: HttpServerOptions,
): Layer.Layer<
  Layer.Success<Serves[number]>,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]> | HttpServer.HttpServer
>;
export function wsServer(
  servesOrOptions?:
    | Layer.Layer<never, any, any>
    | ServerServeList
    | ReadonlyArray<Layer.Layer<never, any, any>>
    | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Layer<never, any, unknown> {
  return serverImpl(
    Resource.serverProtocolWebsocket,
    "WebSocket",
    servesOrOptions,
    maybeOptions,
  );
}

/** Options for {@link ipcServer} — Unix-domain RPC (same-machine). @public */
export interface IpcServerOptions {
  /** Filesystem path for the Unix-domain listen socket (required). */
  readonly path: string;
  readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  /**
   * Node log key for auto-mounted {@link NodeStatus} durable `logs.query`.
   * When omitted, inferred from served tags' bound {@link Node} when all share one key.
   */
  readonly node?: string | { readonly key: string };
  /**
   * Best-effort `unlink` of `path` before bind and when the server scope closes (default `true`).
   * Clears stale `.sock` files from a previous crash so listen does not fail with EADDRINUSE.
   */
  readonly unlink?: boolean;
  /**
   * Soft Lookup directory advertise after serve registration (`Resource.listen` only).
   *
   * @internal
   */
  readonly advertiseNode?: AnyNode & { readonly key: string };
}

/**
 * A **Unix-domain** RPC server — same-machine sibling of {@link httpServer} / {@link wsServer}.
 * Speaks Effect's raw socket RPC protocol (`RpcServer.layerProtocolSocketServer`) over a
 * filesystem path — no HTTP, no WebSocket upgrade. Clients connect with {@link connectIpc}
 * or a node whose {@link ProtocolKind} is `"IpcSocket"` (`Tag("x", { path })`).
 *
 * ```ts
 * class Worker extends Tag<Worker>("worker", { path: "/tmp/worker.sock" }) {}
 *
 * const live = Resource.ipcServer(
 *   [Resource.serve(Jobs, jobsImpl)],
 *   { path: "/tmp/worker.sock" },
 * )
 * // or Resource.listen(Worker, [Resource.serve(Jobs, jobsImpl)])
 * ```
 *
 * Auto-mounts {@link NodeStatus} like the http/ws servers. There is no `/health` HTTP route
 * (no HTTP listener) — probe readiness via NodeStatus over RPC.
 *
 * @public
 */
export function ipcServer<Serve extends Layer.Layer<never, any, any>>(
  serve: Serve,
  options: IpcServerOptions,
): Layer.Layer<
  Layer.Success<Serve>,
  Layer.Error<Serve>,
  Layer.Services<Serve>
>;
export function ipcServer<Serves extends ServerServeList>(
  serves: Serves,
  options: IpcServerOptions,
): Layer.Layer<
  Layer.Success<Serves[number]>,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function ipcServer(
  serves: Layer.Layer<never, any, any> | ServerServeList | ReadonlyArray<Layer.Layer<never, any, any>>,
  options: IpcServerOptions,
): Layer.Layer<never, any, unknown> {
  const list = (
    Array.isArray(serves) ? serves : [serves]
  ) as unknown as ServerServeList;
  return ipcServerBase(options).pipe(
    Layer.provideMerge(mergeServeList(list)),
    // Fresh registry per server — Lookup + Worker in one process must not share.
    Layer.provide(Layer.fresh(Resource.servedResourcesLayer)),
  );
}

/**
 * Non-empty serve-layer list for {@link listen} (deps already discharged).
 * `ROut` bound matches Effect {@link Layer.mergeAll} (`never` = any success via
 * contravariance); `R` is `never` so an array literal is not contextually typed
 * into `Layer.Services = any` (which breaks `Layer.build` / Effect context checks).
 *
 * @internal
 */
type ServeLayerList = readonly [
  Layer.Layer<never, any, never>,
  ...ReadonlyArray<Layer.Layer<never, any, never>>,
];

/**
 * C3: every member of `ROut` must appear in the merged serve `Layer.Success`.
 * (`never` catalog ⇒ no proof — transport dispatch only.)
 *
 * Tuple-wrap the `extends` check so a union `ROut` is not checked distributively
 * (`Jobs | Emails extends Jobs` would otherwise accept a Jobs-only serve list).
 *
 * @internal
 */
type ServesForCatalog<ROut, Serves extends ServeLayerList> = [ROut] extends [
  never,
]
  ? Serves
  : [ROut] extends [Layer.Success<Serves[number]>]
    ? Serves
    : never;

/** `ROut` stamped on a {@link CatalogNode}, or `never` when undeclared. @internal */
type CatalogROut<Node> = Node extends { readonly [catalogSym]?: infer R }
  ? Exclude<R, undefined>
  : never;

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
  // Http / WebSocket only until Node.http / Node.ws (Phase B/C).
  return withListenNode(node, httpWsTransport(node, list, options));
}

/** True when the first arg is a {@link Resource.Tag} (has {@link Resource.specSym}). @internal */
const isResourceTagArg = (u: unknown): u is Resource.PipeableTag =>
  (typeof u === "object" || typeof u === "function") &&
  u !== null &&
  Resource.specSym in u;

/** True when the first arg is a serve layer or non-empty serve list. @internal */
const isServeArg = (
  u: unknown,
): u is Layer.Layer<never, any, never> | ServeLayerList => {
  if (Layer.isLayer(u)) return true;
  return (
    Array.isArray(u) &&
    u.length > 0 &&
    Layer.isLayer(u[0])
  );
};

/** Http / WebSocket (or url-only) Nodes are not Unix-domain IPC. @internal */
const isNonIpcNode = (node: AnyNode): boolean =>
  node.kind === "Http" ||
  node.kind === "WebSocket" ||
  (node.path === undefined && typeof node.url === "string");

/** Nodes that need {@link unix} (IpcSocket / address-less ipc). @internal */
const isIpcListenNode = (node: AnyNode): boolean => {
  if (isNonIpcNode(node)) return false;
  if (typeof node.path === "string") return true;
  if (node.kind === "IpcSocket") return true;
  // Address-less → ipc mint (kind unset).
  return node.path === undefined && node.url === undefined;
};

const failLayer = <E>(error: E): Layer.Layer<never, E> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(error),
      (impossible: never): Layer.Layer<never> => impossible,
    ),
  );

const failUseProtocol = (
  protocol: "unix" | "http" | "ws",
  detail: string,
): Layer.Layer<never, ListenUseProtocol> =>
  failLayer(new ListenUseProtocol({ protocol, detail }));

const failListenTagNode = (fields: {
  readonly tag: string;
  readonly reason: "missing" | "ambiguous";
  readonly count: number;
}): Layer.Layer<never, ListenTagNodeRequired> =>
  failLayer(new ListenTagNodeRequired(fields));

/** Fail a Layer build with {@link UnixListenRequiresIpc}. @internal */
const unixRequiresIpcLayer = (
  node: string,
  kind: string,
): Layer.Layer<never, UnixListenRequiresIpc> =>
  failLayer(new UnixListenRequiresIpc({ node, kind }));

/**
 * Unix-domain IPC listen — all ipc mint/bind + default Lookup bootstrap.
 * Same overload shapes as the old multi-protocol `listen`. Prefer this for same-machine.
 *
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
    advertiseNode,
  });
};

/** True when `node` was built with {@link Node}.Prototype. @internal */
const isPrototypeNode = (node: unknown): boolean =>
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isPrototype?: boolean }).isPrototype === true;

/** True when `node` came from {@link Node}.Prototype.instance. @internal */
const isDynamicInstanceNode = (node: unknown): boolean =>
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isDynamicInstance?: boolean }).isDynamicInstance === true;

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

/** Ephemeral Unix socket path for address-less {@link listen}. @internal */
const ephemeralIpcPath = (nodeKey: string): Effect.Effect<string> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    const safe = nodeKey.replace(/[/\\]/g, "-");
    return `/tmp/effect-pm-${safe}-${now}.sock`;
  });

/** Stamp {@link ListenNode} so identity `serve` claims use the listen endpoint. @internal */
const withListenNode = <A, E, R>(
  node: AnyNode,
  server: Layer.Layer<A, E, R>,
): Layer.Layer<A | ListenNode, E, R> =>
  server.pipe(Layer.provideMerge(Layer.succeed(ListenNode, node)));

/**
 * Http / WebSocket bind for neutral {@link listen} only (Phase A interim).
 * Ipc is {@link unix} → {@link ipcBind}. @internal
 */
const httpWsTransport = (
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
  if (node.kind === "Http") {
    return httpServer(list, httpOpts);
  }
  return unaddressedLayer(node.key);
};

/**
 * Union of Tag `Self` identifiers from a {@link clientsFor} tag list.
 * Shallow {@link Resource.PipeableTag} only — `ResourceTag<…>` here reopens TS2589 under stock tsc.
 *
 * @internal
 */
type ServicesOfTags<Tags extends ReadonlyArray<Resource.PipeableTag>> =
  Tags[number] extends Context.Key<infer S, any> ? S : never;

/**
 * Client layers for a catalog node's `ROut` (C2) — one {@link connect}, no repeated node in
 * each `client` line. Pass the Tag values that make up `ROut` (they must cover it).
 *
 * ```ts
 * Resource.clientsFor(Worker, Jobs, Emails)
 * // Layer<Jobs | Emails> — transport from Worker bundled
 * ```
 *
 * @public
 */

export const clientsFor = <
  // Dialable catalog node — each `client(tag, node)` auto-wires the *same*
  // memoized {@link connectAddressed} Layer (one MemoMap transport).
  Node extends AddressedNode<unknown> & {
    readonly [catalogSym]?: unknown;
  },
  const Tags extends readonly [Resource.PipeableTag, ...ReadonlyArray<Resource.PipeableTag>],
>(
  node: Node,
  // Tuple-wrap — same non-distributive rule as {@link ServesForCatalog}.
  ...tags: [CatalogROut<Node>] extends [ServicesOfTags<Tags>] ? Tags : never
): Layer.Layer<ServicesOfTags<Tags>> => {
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
  ) as Layer.Layer<ServicesOfTags<Tags>>;
};

/** Registry → one RpcServer over a Unix-domain {@link SocketServer}. @internal */
const ipcServerBase = (
  options: IpcServerOptions,
): Layer.Layer<never, never, Resource.ServedResources> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registry = yield* Resource.ServedResources;
      const entries = yield* registry.all;
      if (entries.length === 0) {
        return yield* Effect.die(
          new Error(
            "Node.ipcServer: no resources registered — provideMerge at least one Resource.serve(...) layer",
          ),
        );
      }
      yield* assertProtocolKinds(entries, "IpcSocket");
      const startedAt = yield* Clock.currentTimeMillis;
      const readiness = Effect.forEach(entries, (entry) =>
        Effect.map(entry.readiness, (result) => ({
          key: entry.groupId,
          kind: entry.kind,
          ready: result.ready,
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
        })),
      );
      const optionNodeKey =
        options.node === undefined
          ? undefined
          : typeof options.node === "string"
            ? options.node
            : options.node.key;
      const boundKeys = [
        ...new Set(
          entries.flatMap((entry) =>
            entry.nodeLogKey === undefined ? [] : [entry.nodeLogKey],
          ),
        ),
      ];
      const inferredNodeKey =
        optionNodeKey ?? (boundKeys.length === 1 ? boundKeys[0] : undefined);
      const { nodeStatusServeEntry } = yield* Effect.promise(
        () => import("./nodeStatusResource"),
      );
      const nodeEntry = nodeStatusServeEntry({
        startedAt,
        resourceCount: entries.length,
        readiness,
        ...(inferredNodeKey !== undefined ? { nodeLogKey: inferredNodeKey } : {}),
      });
      const nodeTag = nodeEntry.tag;
      const nodeImpl = (yield* (Effect.isEffect(nodeEntry.impl)
        ? nodeEntry.impl
        : Effect.succeed(nodeEntry.impl))) as Record<string, unknown>;
      const nodeFlat = Resource.flattenImpl(nodeImpl, nodeTag[Resource.specSym]);
      const nodeHandlers: Record<string, (payload: unknown) => unknown> = {};
      for (const [key, member] of Object.entries(nodeFlat)) {
        nodeHandlers[Resource.wireTag(nodeTag.groupId, key)] = (payload) =>
          Resource.invokeWireMethod(member, nodeTag[Resource.specSym][key] as Resource.AnyMethod, payload);
      }
      const merged = [...entries.map((entry) => entry.group), nodeTag[Resource.groupSym]].reduce(
        (acc, group) => acc.merge(group),
      );
      const { NodeFileSystem, NodeSocketServer } = yield* Effect.promise(
        () => import("@effect/platform-node"),
      );
      const doUnlink = options.unlink !== false;
      // Build FileSystem once for path hygiene (Context provide — not Layer provide mid-graph).
      const fsCtx = doUnlink
        ? yield* Layer.build(NodeFileSystem.layer)
        : undefined;
      if (fsCtx !== undefined) {
        yield* Effect.provide(unlinkBestEffort(options.path), fsCtx);
      }
      const rpc = RpcServer.layer(merged).pipe(
        Layer.provide(
          nodeTag[Resource.groupSym].toLayer(
            nodeHandlers as unknown as Parameters<
              (typeof nodeTag)[typeof Resource.groupSym]["toLayer"]
            >[0],
          ),
        ),
        // Fresh per ipcServer — two Unix servers in one process (Lookup + Worker)
        // must not share SocketServer / protocol layers via MemoMap.
        Layer.provide(Layer.fresh(RpcServer.layerProtocolSocketServer)),
        Layer.provide(
          Layer.fresh(options.serialization ?? Resource.defaultSerialization),
        ),
        Layer.provide(
          Layer.fresh(
            NodeSocketServer.layer({ path: options.path }).pipe(Layer.orDie),
          ),
        ),
      );
      const withUnlink =
        fsCtx !== undefined
          ? rpc.pipe(
              Layer.provideMerge(
                Layer.effectDiscard(
                  Effect.addFinalizer(() =>
                    Effect.provide(unlinkBestEffort(options.path), fsCtx),
                  ),
                ),
              ),
            )
          : rpc;
      // After serve registration (+ socket bind layer composed): soft Lookup advertise.
      const advertise = yield* directoryAdvertiseMerge(
        options.advertiseNode,
        entries,
      );
      return withUnlink.pipe(Layer.provideMerge(advertise));
    }),
  ) as unknown as Layer.Layer<never, never, Resource.ServedResources>;

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

/**
 * Prototype Node template (D7) — a Node kind, nested on {@link Node} as `Prototype`.
 * No address until cloned:
 *
 * ```ts
 * class MailWorker extends Prototype<MailWorker, Mail>("app/MailWorker") {}
 * // Named clone with a fixed address (class ctor):
 * class East extends MailWorker.make("East", { path: "/tmp/east.sock" }) {}
 * // Dynamic instances — curry serves once; factory takes suffix (auto when omitted):
 * const mailWorker = MailWorker.listen([Resource.serve(Mail, impl)])
 * mailWorker()
 * mailWorker("w1")
 * ```
 *
 * @public
 */
export const Prototype = <Self, ROut = never>(
  name: string,
  options?: { readonly kind?: ProtocolKind },
) => {
  const instance = (suffix?: string) => {
    const key =
      suffix !== undefined && suffix.length > 0 ? `${name}#${suffix}` : name;
    return Object.assign(Tag<Self, ROut>(key), {
      isDynamicInstance: true as const,
      dynamicPrototypeKey: name,
      ...(suffix !== undefined && suffix.length > 0
        ? { instanceSuffix: suffix }
        : {}),
    });
  };
  function make(
    cloneName: string,
    target: { readonly path: string; readonly kind?: "IpcSocket" },
  ): IpcNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: {
      readonly url: `ws://${string}` | `wss://${string}`;
      readonly kind?: "WebSocket";
    },
  ): WsNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: { readonly url: string; readonly kind: "WebSocket" },
  ): WsNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: { readonly url: string; readonly kind: "Http" },
  ): HttpNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: { readonly url: string; readonly kind?: ProtocolKind },
  ): UrlNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target:
      | { readonly path: string; readonly kind?: "IpcSocket" }
      | { readonly url: string; readonly kind?: ProtocolKind },
  ): IpcNodeTagClass<Self, ROut> | UrlNodeTagClass<Self, ROut> {
    // Branch so each Tag call hits a dialable overload (not the loose union catch-all).
    if ("path" in target) {
      return Tag<Self, ROut>(`${name}#${cloneName}`, {
        path: target.path,
        ...(target.kind !== undefined ? { kind: target.kind } : {}),
      });
    }
    return Tag<Self, ROut>(`${name}#${cloneName}`, {
      url: target.url,
      ...(target.kind !== undefined ? { kind: target.kind } : {}),
    });
  }
  return Object.assign(Context.Service<Self, Record<string, never>>()(name), {
    isPrototype: true as const,
    kind: options?.kind,
    url: undefined as undefined,
    path: undefined as undefined,
    [catalogSym]: undefined as ROut | undefined,
    make,
    /**
     * Dynamic instance Node — wire key `prototypeKey#suffix`, for {@link listen} /
     * {@link peersLayer} `self`. Prefer {@link makePrototype}'s `.listen(serves)` to spawn.
     * Omit `suffix` to mint one at listen.
     */
    instance,
    /**
     * Curry a serve list into a dynamic-instance factory (sugar over
     * `listen(proto.instance(suffix), serves)`). Returns a **Layer** only —
     * after `Layer.build`, the minted Node is {@link ListenNode} in context.
     */
    listen: <Serves extends ServeLayerList>(
      serves: Serves & ServesForCatalog<Exclude<ROut, undefined>, Serves>,
      listenOptions?: NamelessListenOptions,
    ): ((
      suffix?: string,
    ) => Layer.Layer<
      Layer.Success<Serves[number]> | ListenNode,
      never,
      Layer.Services<Serves[number]>
    >) =>
      (suffix?: string) => {
        // Explicit type args — avoid re-inferring `Serves` from the already-proven
        // intersection (nested `ServesForCatalog` would otherwise fail to unify).
        const node = instance(suffix);
        return unix<typeof node, Serves>(node, serves, listenOptions);
      },
  });
};

