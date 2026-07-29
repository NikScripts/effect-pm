/**
 * Http / WebSocket RPC servers — low-level escape hatches for {@link http} / {@link ws} and apps
 * that bind their own platform (`NodeHttpServer.layer`).
 *
 * @internal
 */
import {
  Clock,
  Effect,
  Exit,
  Layer,
  Scope,
  type Redacted,
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
import * as Hyperlink from "../Hyperlink"
import {
  AnyNode,
  ProtocolKind,
  type OnConflict,
} from "./nodeCore"
import {
  assertProtocolKinds,
  closedLayer,
  directoryAdvertiseMerge,
  isServerServeList,
  membershipFromAdvertise,
  mergeServeList,
  retype,
  toServeList,
  type ServerServeLayer,
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
   * Node log key for auto-mounted node-status durable `logs.query`
   * (`Hyperlink.store(Node)` / `Node.logs`). When omitted, inferred from served tags'
   * bound {@link Node} when all share one key.
   */
  readonly node?: string | { readonly key: string };
  /**
   * Soft Lookup directory advertise after serve registration (`Node.http` / `Node.ws` / protocol listen).
   *
   * @internal
   */
  readonly advertiseNode?: AnyNode & { readonly key: string };
  /**
   * Call-site advertise conflict policy (forwarded to {@link Lookup.directoryAdvertiseLayer}).
   *
   * @internal
   */
  readonly onConflict?: OnConflict;
  /**
   * Expected launcher ownership-ack token for {@link Node.assume} on the auto-mounted
   * node-status Hyperlink.
   */
  readonly assumeToken?: string | Redacted.Redacted<string>;
  /**
   * Cooperative `askIncumbent` handler — node-status `yield` (`true` = accept replace).
   */
  readonly onYield?: Effect.Effect<boolean>;
}

/** A server RPC-protocol builder — {@link Hyperlink.serverProtocolHttp} or {@link Hyperlink.serverProtocolWebsocket}. */
type ServerProtocol = (
  path: HttpRouter.PathInput,
) => Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter>

/** Closed layer — overload-impl erase target for dynamic Rpc / router graphs. */
type ClosedLayer = Layer.Layer<never, never, never>;
type HttpServed = Layer.Layer<
  never,
  never,
  Hyperlink.ServedHyperServices | HttpServer.HttpServer
>;

const httpServerBase = (
  serverProtocol: ServerProtocol,
  serverKind: ProtocolKind,
  options?: HttpServerOptions,
): HttpServed => {
  // Retype dynamic Effect factories before calling so their `any`/`unknown` channels never
  // appear at the call site (anyUnknownInErrorContext walks expression types).
  const rpcServerLayer = retype<(group: object) => ClosedLayer>(RpcServer.layer as never);
  const httpRouterAdd = retype<
    (
      method: "GET",
      path: HttpRouter.PathInput,
      handler: Effect.Effect<HttpServerResponse.HttpServerResponse>,
    ) => ClosedLayer
  >(HttpRouter.add as never);
  const httpRouterServe = retype<(routes: ClosedLayer) => ClosedLayer>(
    HttpRouter.serve as never,
  );
  const mergeClosed = retype<(left: ClosedLayer, right: ClosedLayer) => ClosedLayer>(
    Layer.merge as never,
  );
  // unwrap takes `never` so Effect.gen's inferred any/unknown channels never appear at the call site.
  const unwrapServed = retype<(effect: never) => HttpServed>(Layer.unwrap as never);
  return unwrapServed(
    Effect.gen(function* () {
      const registry = yield* Hyperlink.ServedHyperServices;
      const entries = yield* registry.all;
      if (entries.length === 0) {
        return yield* Effect.die(
          new Error(
            "Node.httpServer: no HyperServices registered — provideMerge at least one Hyperlink.serve(...) layer",
          ),
        );
      }
      yield* assertProtocolKinds(entries, serverKind);
      const startedAt = yield* Clock.currentTimeMillis;
      const readiness = Effect.forEach(entries, (entry) =>
        Effect.map(entry.readiness, (result) => ({
          key: entry.wireKey,
          kind: entry.kind,
          ready: result.ready,
          contractHash: entry.contractHash,
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
      // registered HyperServices, so a client can inspect any node without the author wiring it. Built here
      // (not a registered `serve` layer) so it reports the user HyperServices without counting itself.
      const { nodeStatusServeEntry } = yield* Effect.promise(
        () => import("./nodeStatus"),
      );
      const listenScope = yield* Scope.Scope;
      const membership = membershipFromAdvertise(
        options?.advertiseNode,
        entries,
      );
      const { signal: signalListenExit } = yield* Effect.promise(
        () => import("./nodeListenExit"),
      );
      const nodeEntry = nodeStatusServeEntry({
        startedAt,
        serviceCount: entries.length,
        readiness,
        ...(inferredNodeKey !== undefined ? { nodeLogKey: inferredNodeKey } : {}),
        ...(options?.assumeToken !== undefined
          ? { assumeToken: options.assumeToken }
          : {}),
        ...(inferredNodeKey !== undefined ? { assumeNodeKey: inferredNodeKey } : {}),
        ...(options?.onYield !== undefined ? { onYield: options.onYield } : {}),
        ...(membership !== undefined ? { membership } : {}),
        closeListen: Effect.gen(function* () {
          if (membership !== undefined) {
            // Detach so the shutdown RPC can finish before Node.launch tears the scope down.
            yield* Effect.forkDetach(signalListenExit(membership.nodeKey));
            return;
          }
          // No launch latch — best-effort close for Layer.build holders.
          yield* Scope.close(listenScope, Exit.void).pipe(Effect.ignore);
        }),
      });
      const nodeTag = nodeEntry.tag;
      // nodeStatus impl Effect is Effect-bounded with open channels — retype before yield*.
      const nodeImplEffect = retype<Effect.Effect<Record<string, unknown>>>(
        (Effect.isEffect(nodeEntry.impl)
          ? nodeEntry.impl
          : Effect.succeed(nodeEntry.impl)) as never,
      );
      const nodeImpl = yield* nodeImplEffect;
      const nodeFlat = Hyperlink.flattenImpl(nodeImpl, nodeTag[Hyperlink.specSym]);
      const nodeHandlers: Record<string, (payload: unknown) => unknown> = {};
      for (const [key, member] of Object.entries(nodeFlat)) {
        nodeHandlers[Hyperlink.wireTag(nodeTag[Hyperlink.wireKeySym], key)] = (payload) =>
          Hyperlink.invokeWireMethod(member, nodeTag[Hyperlink.specSym][key] as Hyperlink.AnyMethod, payload);
      }
      const merged = [...entries.map((entry) => entry.group), nodeTag[Hyperlink.groupSym]].reduce(
        (acc, group) => acc.merge(group),
      );
      // Transport-agnostic server: `RpcServer.layer` requires the `RpcServer.Protocol` dependency;
      // `serverProtocol` (http for {@link httpServer}, websocket for {@link wsServer}) provides it.
      // Call `toLayer` on the group (don't extract) — RpcGroup methods need `this`.
      const nodeStatusGroup = nodeTag[Hyperlink.groupSym];
      const nodeStatusLayer = retype<ClosedLayer>(
        nodeStatusGroup.toLayer(nodeHandlers as never) as never,
      );
      const rpcAppLayer = retype<ClosedLayer>(
        rpcServerLayer(merged).pipe(
          Layer.provide(nodeStatusLayer),
          Layer.provide(serverProtocol(options?.path ?? "/rpc")),
        ) as never,
      );
      const healthRoute = httpRouterAdd(
        "GET",
        options?.health?.path ?? "/health",
        Effect.gen(function* () {
          const ts = yield* Clock.currentTimeMillis;
          const services = yield* readiness;
          const ok = services.every((service) => service.ready);
          return yield* HttpServerResponse.json({
            status: ok ? "ok" : "degraded",
            listening: true,
            services,
            uptimeMillis: ts - startedAt,
            ts,
          }).pipe(
            Effect.map((response) => HttpServerResponse.setStatus(response, ok ? 200 : 503)),
            Effect.orDie,
          );
        }),
      );
      const served = retype<ClosedLayer>(
        httpRouterServe(mergeClosed(rpcAppLayer, healthRoute)).pipe(
          Layer.provideMerge(options?.serialization ?? Hyperlink.defaultSerialization),
        ) as never,
      );
      const advertise = yield* directoryAdvertiseMerge(
        options?.advertiseNode,
        entries,
        options?.onConflict !== undefined
          ? { onConflict: options.onConflict }
          : undefined,
      );
      return retype<HttpServed>(
        served.pipe(Layer.provideMerge(closedLayer(advertise))) as never,
      );
    }) as never,
  );
};


/**
 * The shared http server for HyperServices composed with {@link serve} — the multi-hyperlink,
 * heterogeneous-dependency counterpart to a single {@link serve} layer. Reads the
 * {@link ServedHyperServices} registry, merges every registered group onto **one** `RpcServer` at `path`
 * (default `/rpc`), and mounts a `/health` route aggregating each HyperService's readiness. Because each
 * `serve` layer carries **its own** `Layer.provide`d dependency, HyperServices needing different
 * implementations of the same tag stay isolated — no shared union-provide.
 *
 * Pass the `serve` layers as the first argument (recommended) — it bundles the `provideMerge` +
 * {@link Hyperlink.servedHyperServicesLayer}, so you list HyperServices and provide only the platform (and any shared
 * dependency):
 *
 * ```ts
 * const Node = Hyperlink.httpServer([
 *   // homogeneous majority — one shared dependency, stated once
 *   Hyperlink.provide(ImportHandlers.plain, [
 *     Hyperlink.serve(SeasonMatches, seasonMatchesImpl),
 *     Hyperlink.serve(LiveScorePoller, pollerImpl),
 *   ]),
 *   // outlier — private dependency, isolated on its own serve layer
 *   Hyperlink.serve(SeasonImport, importImpl).pipe(Layer.provide(ImportHandlers.hooked)),
 * ], { health: { path: "/health" } }).pipe(
 *   Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
 * );
 * ```
 *
 * Prefer this shape over rewriting around a retired bag API: one {@link httpServer}, mixed
 * shared + isolated deps, no second port.
 *
 * The low-level `httpServer(options)` form requires you to `Layer.provideMerge` the `serve` layers (kept,
 * not pruned) + {@link Hyperlink.servedHyperServicesLayer} yourself. Either way the handlers ride the context the
 * `serve` layers provide; if one is missing the `RpcServer` fails at **build** (a clear boot error), never
 * a silent runtime gap.
 *
 * @category servers
 * @public
 */
export function httpServer<A, E, R>(
  serve: Layer.Layer<A, E, R>,
  options?: HttpServerOptions,
): Layer.Layer<A, E, R | HttpServer.HttpServer>;
export function httpServer(
  options?: HttpServerOptions,
): Layer.Layer<never, never, Hyperlink.ServedHyperServices | HttpServer.HttpServer>;
export function httpServer<const Serves extends ServerServeList>(
  serves: Serves,
  options?: HttpServerOptions,
): Layer.Layer<
  Layer.Success<Serves[number]>,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]> | HttpServer.HttpServer
>;
export function httpServer(
  servesOrOptions?: ServerServeLayer | ServerServeList | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Any {
  return serverImpl(Hyperlink.serverProtocolHttp, "Http", servesOrOptions, maybeOptions);
}

// Shared body for {@link httpServer} / {@link wsServer} — identical wiring, differing only in the
// server RPC protocol. The serves form bundles the boilerplate: provideMerge the serve layers (kept,
// not pruned) + the shared registry, so the caller lists HyperServices and provides only the platform (+
// any shared dep). One serve layer or many — a single `Layer` is treated as a one-element list.
// Overload impl returns {@link Layer.Any}; public overloads reify serve-list Success/Error/Services.
function serverImpl(
  serverProtocol: ServerProtocol,
  serverKind: ProtocolKind,
  servesOrOptions?: ServerServeLayer | ServerServeList | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Any {
  // Duck-check a single Layer (avoid Layer.isLayer on the options union — unknown channels).
  const serves =
    isServerServeList(servesOrOptions)
      ? servesOrOptions
      : servesOrOptions !== undefined &&
          typeof servesOrOptions === "object" &&
          !Array.isArray(servesOrOptions) &&
          "build" in servesOrOptions
        ? toServeList(servesOrOptions as ServerServeLayer)
        : undefined;
  if (serves !== undefined) {
    return httpServerBase(serverProtocol, serverKind, maybeOptions).pipe(
      Layer.provideMerge(closedLayer(mergeServeList(serves))),
      Layer.provide(Layer.fresh(Hyperlink.servedHyperServicesLayer)),
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
 * subscribes to (each HyperService's `status` + `metrics` + `logs`) rides **one multiplexed WebSocket per
 * client**, so a dashboard never trips the browser's ~6-connection-per-origin HTTP/1.1 cap that
 * starves streams over plain HTTP. Identical to {@link httpServer} in every other way — same serve
 * list, same options, same `/health` — it just speaks WebSocket instead of HTTP POST. Clients connect
 * with {@link Hyperlink.ws} (or `Hyperlink.layerProtocol(Hyperlink.protocolWebsocket())`); a fleet whose
 * peers also serve over this should add `Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)`.
 *
 * ```ts
 * const Node = Hyperlink.wsServer([Hyperlink.serve(Jobs, jobsImpl)]).pipe(
 *   Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
 * );
 * ```
 *
 * @category servers
 * @public
 */
export function wsServer<A, E, R>(
  serve: Layer.Layer<A, E, R>,
  options?: HttpServerOptions,
): Layer.Layer<A, E, R | HttpServer.HttpServer>;
export function wsServer(
  options?: HttpServerOptions,
): Layer.Layer<never, never, Hyperlink.ServedHyperServices | HttpServer.HttpServer>;
export function wsServer<const Serves extends ServerServeList>(
  serves: Serves,
  options?: HttpServerOptions,
): Layer.Layer<
  Layer.Success<Serves[number]>,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]> | HttpServer.HttpServer
>;
export function wsServer(
  servesOrOptions?: ServerServeLayer | ServerServeList | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Any {
  return serverImpl(
    Hyperlink.serverProtocolWebsocket,
    "WebSocket",
    servesOrOptions,
    maybeOptions,
  );
}
