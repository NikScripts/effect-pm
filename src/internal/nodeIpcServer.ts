/**
 * Unix-domain RPC server — low-level escape hatch for {@link unix} and Lookup.
 *
 * @internal
 */
import {
  Clock,
  Effect,
  Layer,
} from "effect"
import {
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc"
import { unlinkBestEffort } from "./ipcPath"
import * as Resource from "../Resource"
import {
  AnyNode,
  type OnConflict,
} from "./nodeCore"
import {
  assertProtocolKinds,
  directoryAdvertiseMerge,
  mergeServeList,
  type ServerServeList,
} from "./nodeServerCommon"

/**
 * Options for {@link ipcServer} — Unix-domain RPC (same-machine).
 *
 * @category models
 * @public
 */
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
   * Soft Lookup directory advertise after serve registration (`Node.unix` / protocol listen).
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
 * // or Node.unix(Worker, [Resource.serve(Jobs, jobsImpl)])
 * ```
 *
 * Auto-mounts {@link NodeStatus} like the http/ws servers. There is no `/health` HTTP route
 * (no HTTP listener) — probe readiness via NodeStatus over RPC.
 *
 * @category servers
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
        options.onConflict !== undefined
          ? { onConflict: options.onConflict }
          : undefined,
      );
      return withUnlink.pipe(Layer.provideMerge(advertise));
    }),
  ) as unknown as Layer.Layer<never, never, Resource.ServedResources>;
