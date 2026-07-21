/**
 * Http / WebSocket RPC servers — low-level escape hatches for {@link http} / {@link ws} and apps
 * that bind their own platform (`NodeHttpServer.layer`).
 *
 * @internal
 */
import {
  Clock,
  Effect,
  Layer,
} from "effect"
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http"
import {
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc"
import * as Resource from "../Resource"
import {
  AnyNode,
  ProtocolKind,
} from "./nodeCore"
import {
  assertProtocolKinds,
  directoryAdvertiseMerge,
  mergeServeList,
  type ServerServeList,
} from "./nodeServerCommon"

/**
 * Options for {@link httpServer}.
 *
 * @category models
 * @public
 */
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
   * Soft Lookup directory advertise after serve registration (`Node.http` / `Node.ws` / protocol listen).
   *
   * @internal
   */
  readonly advertiseNode?: AnyNode & { readonly key: string };
}

/** A server RPC-protocol builder — {@link Resource.serverProtocolHttp} or {@link Resource.serverProtocolWebsocket}. */
type ServerProtocol = (
  path: HttpRouter.PathInput,
) => Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter>

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
 * @category servers
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
 * @category servers
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
