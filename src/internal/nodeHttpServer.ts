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
import * as Hyperlink from "../Hyperlink"
import {
  AnyNode,
  ProtocolKind,
  type OnConflict,
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
}

/** A server RPC-protocol builder — {@link Hyperlink.serverProtocolHttp} or {@link Hyperlink.serverProtocolWebsocket}. */
type ServerProtocol = (
  path: HttpRouter.PathInput,
) => Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter>

type ErasedChannel = NonNullable<unknown>

const toServeList = (
  layers: ReadonlyArray<Layer.Layer<never, ErasedChannel, ErasedChannel>>,
): ServerServeList | undefined => {
  const [first, ...rest] = layers;
  return first === undefined ? undefined : [first, ...rest];
}

const isServeArray = (
  value: unknown,
): value is ReadonlyArray<Layer.Layer<never, ErasedChannel, ErasedChannel>> =>
  Array.isArray(value);

const isServeLayer = (
  value: unknown,
): value is Layer.Layer<never, ErasedChannel, ErasedChannel> =>
  Layer.isLayer(value) === true;

type ServerArg = Layer.Layer<never, ErasedChannel, ErasedChannel> | ServerServeList | HttpServerOptions | undefined;

type ServerResult<Arg> = Arg extends Layer.Layer<never, infer E, infer R>
  ? Layer.Layer<Layer.Success<Arg>, E, R | HttpServer.HttpServer>
  : Arg extends ServerServeList
    ? Layer.Layer<
        Layer.Success<Arg[number]>,
        Layer.Error<Arg[number]>,
        Layer.Services<Arg[number]> | HttpServer.HttpServer
      >
    : Layer.Layer<never, never, Hyperlink.ServedHyperlinks | HttpServer.HttpServer>;

const httpServerBase = (
  serverProtocol: ServerProtocol,
  serverKind: ProtocolKind,
  options?: HttpServerOptions,
): Layer.Layer<never, never, Hyperlink.ServedHyperlinks | HttpServer.HttpServer> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registry = yield* Hyperlink.ServedHyperlinks;
      const entries = yield* registry.all;
      if (entries.length === 0) {
        return yield* Effect.die(
          new Error(
            "Node.httpServer: no resources registered — provideMerge at least one Hyperlink.serve(...) layer",
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
      // registered resources, so a client can inspect any node without the author wiring it. Built here
      // (not a registered `serve` layer) so it reports the user resources without counting itself.
      const { nodeStatusServeEntry } = yield* Effect.promise(
        () => import("./nodeStatus"),
      );
      const nodeEntry = nodeStatusServeEntry({
        startedAt,
        resourceCount: entries.length,
        readiness,
        ...(inferredNodeKey !== undefined ? { nodeLogKey: inferredNodeKey } : {}),
      });
      const nodeTag = nodeEntry.tag;
      const rawNodeImpl: unknown = nodeEntry.impl;
      const nodeImplEffect: Effect.Effect<unknown> = Effect.isEffect(rawNodeImpl)
        ? Effect.orDie(rawNodeImpl as Effect.Effect<unknown, ErasedChannel, never>)
        : Effect.succeed(rawNodeImpl);
      const nodeImpl = (yield* nodeImplEffect) as Record<string, unknown>;
      const nodeFlat = Hyperlink.flattenImpl(nodeImpl, nodeTag[Hyperlink.specSym]);
      const nodeHandlers: Record<string, (payload: unknown) => unknown> = {};
      for (const [key, member] of Object.entries(nodeFlat)) {
        nodeHandlers[Hyperlink.wireTag(nodeTag.groupId, key)] = (payload) =>
          Hyperlink.invokeWireMethod(member, nodeTag[Hyperlink.specSym][key] as Hyperlink.AnyMethod, payload);
      }
      const merged = [...entries.map((entry) => entry.group), nodeTag[Hyperlink.groupSym]].reduce(
        (acc, group) => acc.merge(group),
      );
      // Transport-agnostic server: `RpcServer.layer` requires the `RpcServer.Protocol` dependency;
      // `serverProtocol` (http for {@link httpServer}, websocket for {@link wsServer}) provides it — an
      // http POST handler or a ws upgrade — on the same router (`HttpRouter.serve` below).
      const rpcAppLayer = (RpcServer.layer(merged as never) as Layer.Layer<never>).pipe(
        Layer.provide(
          nodeTag[Hyperlink.groupSym].toLayer(
            nodeHandlers as never,
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
      ) as any as Layer.Layer<never, never, never>;
      const served = HttpRouter.serve(Layer.merge(rpcAppLayer, healthRoute)).pipe(
        Layer.provideMerge(options?.serialization ?? Hyperlink.defaultSerialization),
      ) as any as Layer.Layer<never, never, HttpServer.HttpServer>;
      const advertise = yield* directoryAdvertiseMerge(
        options?.advertiseNode,
        entries,
        options?.onConflict !== undefined
          ? { onConflict: options.onConflict }
          : undefined,
      );
      return served.pipe(Layer.provideMerge(advertise));
    }),
  ) as Layer.Layer<never, never, Hyperlink.ServedHyperlinks | HttpServer.HttpServer>;


/**
 * The shared http server for resources composed with {@link serve} — the multi-resource,
 * heterogeneous-dependency counterpart to a single {@link serve} layer. Reads the
 * {@link ServedHyperlinks} registry, merges every registered group onto **one** `RpcServer` at `path`
 * (default `/rpc`), and mounts a `/health` route aggregating each resource's readiness. Because each
 * `serve` layer carries **its own** `Layer.provide`d dependency, resources needing different
 * implementations of the same tag stay isolated — no shared union-provide.
 *
 * Pass the `serve` layers as the first argument (recommended) — it bundles the `provideMerge` +
 * {@link Hyperlink.servedHyperlinksLayer}, so you list resources and provide only the platform (and any shared
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
 * not pruned) + {@link Hyperlink.servedHyperlinksLayer} yourself. Either way the handlers ride the context the
 * `serve` layers provide; if one is missing the `RpcServer` fails at **build** (a clear boot error), never
 * a silent runtime gap.
 *
 * @category servers
 * @public
 */
export function httpServer<Arg extends ServerArg = undefined>(
  servesOrOptions?: Arg,
  maybeOptions?: HttpServerOptions,
): ServerResult<Arg> {
  return serverImpl(Hyperlink.serverProtocolHttp, "Http", servesOrOptions, maybeOptions) as never;
}

// Shared body for {@link httpServer} / {@link wsServer} — identical wiring, differing only in the
// server RPC protocol. The serves form bundles the boilerplate: provideMerge the serve layers (kept,
// not pruned) + the shared registry, so the caller lists resources and provides only the platform (+
// any shared dep). One serve layer or many — a single `Layer` is treated as a one-element list.
function serverImpl<A = never, E = never, R = never>(
  serverProtocol: ServerProtocol,
  serverKind: ProtocolKind,
  servesOrOptions?: unknown,
  maybeOptions?: HttpServerOptions,
): Layer.Layer<A, E, R> {
  const serves: ServerServeList | undefined = isServeArray(servesOrOptions)
    ? toServeList(servesOrOptions)
    : isServeLayer(servesOrOptions)
      ? [servesOrOptions]
      : undefined;
  if (serves !== undefined) {
    return httpServerBase(serverProtocol, serverKind, maybeOptions).pipe(
      Layer.provideMerge(mergeServeList(serves)),
      Layer.provide(Layer.fresh(Hyperlink.servedHyperlinksLayer)),
    ) as never;
  }
  return httpServerBase(
    serverProtocol,
    serverKind,
    servesOrOptions as HttpServerOptions | undefined,
  ) as never;
}

/**
 * A **WebSocket** RPC server — the {@link httpServer} sibling for the browser. Everything a client
 * subscribes to (each resource's `status` + `metrics` + `logs`) rides **one multiplexed WebSocket per
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
export function wsServer<Arg extends ServerArg = undefined>(
  servesOrOptions?: Arg,
  maybeOptions?: HttpServerOptions,
): ServerResult<Arg> {
  return serverImpl(
    Hyperlink.serverProtocolWebsocket,
    "WebSocket",
    servesOrOptions,
    maybeOptions,
  ) as never;
}
