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
import * as Hyperlink from "../Hyperlink"
import {
  AnyNode,
  type OnConflict,
} from "./nodeCore"
import {
  assertProtocolKinds,
  closedLayer,
  directoryAdvertiseMerge,
  mergeServeList,
  retype,
  toServeList,
  type ServerServeLayer,
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
   * Node log key for auto-mounted node-status durable `logs.query`.
   * When omitted, inferred from served tags' bound {@link Node} when all share one key.
   */
  readonly node?: string | { readonly key: string };
  /**
   * Best-effort `unlink` of `path` before bind and when the server scope closes
   * (default `false` — same as {@link Lookup.layerOptions} / named-pipe listen).
   * Opt in with `unlink: true` to clear a stale `.sock` from a previous crash; leaving the
   * default avoids unlink-steal of a live peer's socket.
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
 * or a node whose {@link ProtocolKind} is `"IpcSocket"` (`Tag()("x", { path })`).
 *
 * ```ts
 * class Worker extends Tag<Worker>()("worker", { path: "/tmp/worker.sock" }) {}
 *
 * const live = Hyperlink.ipcServer(
 *   [Hyperlink.serve(Jobs, jobsImpl)],
 *   { path: "/tmp/worker.sock" },
 * )
 * // or Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)])
 * ```
 *
 * Auto-mounts node status/logs/ping like the http/ws servers. There is no `/health` HTTP route
 * (no HTTP listener) — probe readiness via the node-handle status RPC.
 *
 * @category servers
 * @public
 */
export function ipcServer<A, E, R>(
  serve: Layer.Layer<A, E, R>,
  options: IpcServerOptions,
): Layer.Layer<A, E, R>;
export function ipcServer<const Serves extends ServerServeList>(
  serves: Serves,
  options: IpcServerOptions,
): Layer.Layer<
  Layer.Success<Serves[number]>,
  Layer.Error<Serves[number]>,
  Layer.Services<Serves[number]>
>;
export function ipcServer(
  serves: ServerServeLayer | ServerServeList,
  options: IpcServerOptions,
): Layer.Any {
  const list = toServeList(serves);
  return ipcServerBase(options).pipe(
    Layer.provideMerge(closedLayer(mergeServeList(list))),
    // Fresh registry per server — Lookup + Worker in one process must not share.
    Layer.provide(Layer.fresh(Hyperlink.servedHyperlinksLayer)),
  );
}

/** Closed layer — overload-impl erase target for dynamic Rpc graphs. */
type ClosedLayer = Layer.Layer<never, never, never>;
type IpcServed = Layer.Layer<never, never, Hyperlink.ServedHyperlinks>;

/** Registry → one RpcServer over a Unix-domain {@link SocketServer}. @internal */
const ipcServerBase = (options: IpcServerOptions): IpcServed => {
  const rpcServerLayer = retype<(group: object) => ClosedLayer>(
    RpcServer.layer as never,
  );
  const unwrapServed = retype<(effect: never) => IpcServed>(Layer.unwrap as never);
  return unwrapServed(
    Effect.gen(function* () {
      const registry = yield* Hyperlink.ServedHyperlinks;
      const entries = yield* registry.all;
      if (entries.length === 0) {
        return yield* Effect.die(
          new Error(
            "Node.ipcServer: no resources registered — provideMerge at least one Hyperlink.serve(...) layer",
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
          contractHash: entry.contractHash,
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
        () => import("./nodeStatus"),
      );
      const nodeEntry = nodeStatusServeEntry({
        startedAt,
        resourceCount: entries.length,
        readiness,
        ...(inferredNodeKey !== undefined ? { nodeLogKey: inferredNodeKey } : {}),
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
        nodeHandlers[Hyperlink.wireTag(nodeTag.groupId, key)] = (payload) =>
          Hyperlink.invokeWireMethod(member, nodeTag[Hyperlink.specSym][key] as Hyperlink.AnyMethod, payload);
      }
      const merged = [...entries.map((entry) => entry.group), nodeTag[Hyperlink.groupSym]].reduce(
        (acc, group) => acc.merge(group),
      );
      const { NodeFileSystem, NodeSocketServer } = yield* Effect.promise(
        () => import("@effect/platform-node"),
      );
      const doUnlink = options.unlink === true;
      // Build FileSystem once for path hygiene (Context provide — not Layer provide mid-graph).
      const fsCtx = doUnlink
        ? yield* Layer.build(NodeFileSystem.layer)
        : undefined;
      if (fsCtx !== undefined) {
        yield* Effect.provide(unlinkBestEffort(options.path), fsCtx);
      }
      // Call `toLayer` on the group (don't extract) — RpcGroup methods need `this`.
      const nodeStatusGroup = nodeTag[Hyperlink.groupSym];
      const nodeStatusLayer = retype<ClosedLayer>(
        nodeStatusGroup.toLayer(nodeHandlers as never) as never,
      );
      const socketServerLayer = retype<(options: { readonly path: string }) => ClosedLayer>(
        NodeSocketServer.layer as never,
      );
      const rpc = retype<ClosedLayer>(
        rpcServerLayer(merged).pipe(
          Layer.provide(nodeStatusLayer),
          // Fresh per ipcServer — two Unix servers in one process (Lookup + Worker)
          // must not share SocketServer / protocol layers via MemoMap.
          Layer.provide(Layer.fresh(RpcServer.layerProtocolSocketServer)),
          Layer.provide(
            Layer.fresh(options.serialization ?? Hyperlink.defaultSerialization),
          ),
          Layer.provide(Layer.fresh(socketServerLayer({ path: options.path }))),
        ) as never,
      );
      const withUnlink =
        fsCtx !== undefined
          ? retype<ClosedLayer>(
              rpc.pipe(
                Layer.provideMerge(
                  Layer.effectDiscard(
                    Effect.addFinalizer(() =>
                      Effect.provide(unlinkBestEffort(options.path), fsCtx),
                    ),
                  ),
                ),
              ) as never,
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
      return retype<IpcServed>(
        withUnlink.pipe(Layer.provideMerge(closedLayer(advertise))) as never,
      );
    }) as never,
  );
};
