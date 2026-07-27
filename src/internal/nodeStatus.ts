/**
 * @module internal/nodeStatus
 *
 * The reserved **node status** resource — every node that serves a group over
 * {@link Node.httpServer} automatically also serves this, so a client can ask any node
 * "are you up, how long, how many resources, and what are your logs?" without the node author
 * wiring anything. It's a nodeless {@link Hyperlink.Tag} (one reserved group id); a client reaches
 * a specific node by pointing the ambient transport at that node's url.
 *
 * Kept internal so {@link Hyperlink} can dynamically import it from `httpServer` without a
 * static cycle (`Hyperlink` ⇄ this). The public face is the NODE HANDLE accessors (`yield* node`
 * -> ping/status/logs) wired in `internal/nodeConnect`; see `Node` for the light status types.
 */
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Stream,
} from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { FetchHttpClient } from "effect/unstable/http";
import type { AddressedNode } from "./nodeCore";
import * as Hyperlink from "../Hyperlink";
import { NodeUnreachable, type NodeStatusAccessors } from "./nodeCore";
import { Relay as LogRelay } from "../Logs";
import { LogEntrySchema } from "../LogEntry";
import type { LogEntry } from "../LogEntry";
import { queryDurableNode } from "./logs/durableRead";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
  assumeError,
  assumePayload,
  nodeOwnership,
  type NodeOwnership,
} from "./nodeAssume";

/** The reserved group id (wire prefix) for the node status resource. */
const NODE_STATUS_KEY = "hyperlink-ts/node-status";

/** How often the live {@link NodeStatusTag} `status` stream re-emits a snapshot. */
const STATUS_INTERVAL = Duration.seconds(2);

/**
 * One served resource's readiness, as the node reports it — its wire key, {@link Hyperlink.kindOf}
 * kind, optional F4 {@link contractHash}, whether it's ready, and (when not) why. The element of
 * {@link nodeStatus}'s `resources`.
 *
 * @internal
 */
export const resourceReadiness = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  ready: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
  /** Wire-contract fingerprint (F4) — stamped at serve from the tag Spec. */
  contractHash: Schema.optionalKey(Schema.String),
});

/** A served resource's readiness as reported by its node. @internal */
export type ResourceReadiness = typeof resourceReadiness.Type;

/**
 * A node's live status — whether it's up, its overall readiness rollup, when it started, how long
 * it's been up, how many resources it serves, and each resource's readiness. `status` is `degraded`
 * (and `/health` returns 503) when any served resource is not ready.
 *
 * @internal
 */
export const nodeStatus = Schema.Struct({
  up: Schema.Boolean,
  status: Schema.Literals(["ok", "degraded"]),
  startedAt: Schema.DateTimeUtc,
  uptimeMillis: Schema.Number,
  resourceCount: Schema.Number,
  resources: Schema.Array(resourceReadiness),
  /**
   * Custody mirror when the node was started with an assume token (`"launcher"` until
   * {@link NodeStatusTag}.`assume` succeeds, then `"self"`). Omitted when no assume token.
   */
  ownership: Schema.optionalKey(nodeOwnership),
});

/** Live node status. @internal */
export type NodeStatus = typeof nodeStatus.Type;

/**
 * The reserved node status resource tag — nodeless, so a client queries it over whichever node
 * transport it points the ambient `RpcClient.Protocol` at.
 *
 * @internal
 */
export class NodeStatusTag extends Hyperlink.Tag<NodeStatusTag>()(
  NODE_STATUS_KEY,
  {
  status: Hyperlink.ref(nodeStatus).annotate({
    description:
      "Live node status (up / uptime / resource count / per-resource readiness) — " +
      "`status.get` for one-shot, `status.changes` re-emitted periodically.",
  }),
  ping: Hyperlink.effect(Schema.Number).annotate({
    description: "Server epoch milliseconds — a round-trip liveness probe.",
  }),
  /**
   * Cooperative handoff ask (Lookup `askIncumbent`) — `true` = step aside so a
   * newcomer may take this `nodeKey`. Not Effect `yield*`; wire RPC only.
   */
  yield: Hyperlink.effect(Schema.Boolean).annotate({
    description:
      "Cooperative handoff: true = accept yield (Lookup may replace the directory row). " +
      "Refuse with false. Distinct from Effect generator yield*.",
  }),
  /**
   * Launcher → node ownership ack — child assumes self-custody so the launcher may exit.
   * Rejects until Ready; token is single-use; mismatch / reuse / not-ready are loud tagged errors.
   */
  assume: Hyperlink.effectFn({
    payload: assumePayload,
    success: Schema.Void,
    error: assumeError,
  }).annotate({
    description:
      "Assume process ownership from the launcher (`{ token }`). Ready required; single-use token.",
  }),
  logs: {
    stream: Hyperlink.stream(LogEntrySchema).annotate({
      description:
        "Runtime-wide node log stream (recent tail, then live). Empty unless Logs.layer is provided.",
    }),
    query: Hyperlink.effectFn({ limit: Schema.Number }, Schema.Array(LogEntrySchema)).annotate({
      description:
        "Replay persisted node logs (newest `limit`) from `Hyperlink.store(Node)` / `Node.logs` " +
        "registration Storage. Empty when the node journal is not registered (or `nodeLogKey` unknown).",
    }),
  },
}) {}

/** Build the node status service implementation for a node that started at `startedAt` and serves
 *  `resourceCount` resources. Logs/history are optional (read via `serviceOption`), so this adds no
 *  requirement to the server layer. When `assumeToken` is set, `assume` / ownership mirror are live.
 *  @internal */
export const buildNodeStatusImpl = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  /** Per-resource readiness aggregate (same one `/health` reads); absent ⇒ no resources, `ok`. */
  readonly readiness?: Effect.Effect<ReadonlyArray<ResourceReadiness>>;
  /**
   * Node log key for durable `logs.query` via registration Storage (`Node.logs`).
   * When omitted, query returns `[]`.
   */
  readonly nodeLogKey?: string;
  /**
   * Cooperative handoff handler for {@link NodeStatusTag}.`yield`.
   * Default: accept (`true`) — Lookup then replaces the directory row.
   */
  readonly onYield?: Effect.Effect<boolean>;
  /**
   * Expected launcher handoff token. When set, ownership starts as `"launcher"` and
   * {@link NodeStatusTag}.`assume` is armed. Cleartext or {@link Redacted}.
   */
  readonly assumeToken?: string | Redacted.Redacted<string>;
  /** Node key stamped into assume errors (defaults to the reserved status key). */
  readonly assumeNodeKey?: string;
}): Effect.Effect<{
  readonly status: Hyperlink.Subscribable<NodeStatus>;
  readonly ping: Effect.Effect<number>;
  readonly yield: Effect.Effect<boolean>;
  readonly assume: (payload: {
    readonly token: string;
  }) => Effect.Effect<void, AssumeTokenMismatch | AssumeTokenReused | AssumeNotReady>;
  readonly logs: {
    readonly stream: Stream.Stream<LogEntry>;
    readonly query: (payload: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<LogEntry>>;
  };
}> =>
  Effect.gen(function* () {
    const readiness = options.readiness ?? Effect.succeed([]);
    const expectedToken =
      options.assumeToken === undefined
        ? undefined
        : Redacted.isRedacted(options.assumeToken)
          ? Redacted.value(options.assumeToken)
          : options.assumeToken;
    const assumeNodeKey = options.assumeNodeKey ?? NODE_STATUS_KEY;
    const ownership = yield* Ref.make<NodeOwnership>(
      expectedToken !== undefined ? "launcher" : "self",
    );
    const assumed = yield* Ref.make(false);
    const computeStatus: Effect.Effect<NodeStatus> = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const resources = yield* readiness;
      const ok = resources.every((r) => r.ready);
      const status: "ok" | "degraded" = ok ? "ok" : "degraded";
      const ownershipValue = yield* Ref.get(ownership);
      return {
        up: true,
        status,
        startedAt: DateTime.makeUnsafe(options.startedAt),
        uptimeMillis: now - options.startedAt,
        resourceCount: options.resourceCount,
        resources,
        ...(expectedToken !== undefined ? { ownership: ownershipValue } : {}),
      };
    });
    const statusSub: Hyperlink.Subscribable<NodeStatus> = {
      get: computeStatus,
      changes: Stream.tick(STATUS_INTERVAL).pipe(Stream.mapEffect(() => computeStatus)),
    };
    const logsLive = Stream.unwrap(
      Effect.gen(function* () {
        const relay = yield* Effect.serviceOption(LogRelay);
        if (Option.isNone(relay)) return Stream.empty;
        const tail = yield* relay.value.snapshot;
        return Stream.concat(Stream.fromIterable(tail), relay.value.stream);
      }),
    );
    const assume = (payload: {
      readonly token: string;
    }): Effect.Effect<
      void,
      AssumeTokenMismatch | AssumeTokenReused | AssumeNotReady
    > =>
      Effect.gen(function* () {
        if (expectedToken === undefined || payload.token !== expectedToken) {
          yield* Effect.logWarning("assume rejected: token mismatch").pipe(
            Effect.annotateLogs({ "assume.node": assumeNodeKey }),
          );
          return yield* new AssumeTokenMismatch({ node: assumeNodeKey });
        }
        if (yield* Ref.get(assumed)) {
          yield* Effect.logWarning("assume rejected: token already used").pipe(
            Effect.annotateLogs({ "assume.node": assumeNodeKey }),
          );
          return yield* new AssumeTokenReused({ node: assumeNodeKey });
        }
        const resources = yield* readiness;
        const blocked = resources.find((r) => !r.ready);
        if (blocked !== undefined) {
          yield* Effect.logWarning("assume rejected: not Ready").pipe(
            Effect.annotateLogs({
              "assume.node": assumeNodeKey,
              "assume.resource": blocked.key,
            }),
          );
          return yield* new AssumeNotReady({
            node: assumeNodeKey,
            resource: blocked.key,
            ...(blocked.detail !== undefined ? { detail: blocked.detail } : {}),
          });
        }
        yield* Ref.set(assumed, true);
        yield* Ref.set(ownership, "self");
        yield* Effect.logInfo("ownership assumed (self)").pipe(
          Effect.annotateLogs({
            "assume.node": assumeNodeKey,
            "assume.ownership": "self",
          }),
        );
      }).pipe(Effect.withLogSpan("node.assume.handle"));
    return {
      status: statusSub,
      ping: Clock.currentTimeMillis,
      // Default accept — Lookup askIncumbent replaces the row; dial-matched unregister
      // prevents a late finalizer from wiping the newcomer.
      yield: options.onYield ?? Effect.succeed(true),
      assume,
      logs: {
        stream: logsLive,
        query: (payload: { readonly limit: number }) =>
          options.nodeLogKey !== undefined
            ? queryDurableNode(options.nodeLogKey, { limit: payload.limit })
            : Effect.succeed([] as ReadonlyArray<LogEntry>),
      },
    };
  });

/**
 * The reserved node-status resource paired with its built impl — the `{ tag, impl }` that
 * {@link Node.httpServer} folds onto every node's `RpcServer` automatically, so every node
 * exposes its status + logs without the author wiring it.
 *
 * @internal
 */
export const nodeStatusServeEntry = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  readonly readiness?: Effect.Effect<ReadonlyArray<ResourceReadiness>>;
  readonly nodeLogKey?: string;
  readonly assumeToken?: string | Redacted.Redacted<string>;
  readonly assumeNodeKey?: string;
  readonly onYield?: Effect.Effect<boolean>;
}): {
  readonly tag: typeof NodeStatusTag;
  readonly impl: ReturnType<typeof buildNodeStatusImpl>;
} => ({
  tag: NodeStatusTag,
  impl: buildNodeStatusImpl(options),
});

/**
 * Build the {@link NodeStatusAccessors} for a connected node from its own transport `protocol` — the
 * real dial logic behind `yield* MyNode` → `n.ping` / `n.status` / `n.logs`. Verify is off (this IS
 * the health probe); every access dials the node's reserved status resource, scoped per read. Called
 * lazily from `connectLayer` via dynamic import so nodeConnect never statically pulls this engine.
 * @internal
 */
export const nodeStatusAccessors = (
  protocol: Context.Service.Shape<typeof RpcClient.Protocol>,
): NodeStatusAccessors => {
  const clientLayer = Hyperlink.client(NodeStatusTag).pipe(
    Layer.provide(Layer.succeed(RpcClient.Protocol, protocol)),
    Layer.provide(Hyperlink.clientVerify(false)),
  );
  const toUnreachable = (cause: unknown) =>
    new NodeUnreachable({ node: NODE_STATUS_KEY, url: "node handle", cause });
  // One-shot read: build the per-node status client into a Context (scoped) and provide THAT — never
  // `Effect.provide(effect, Layer)` in a library internal (breaks scope lifetimes; strictEffectProvide).
  const oneShot = <A, E>(
    read: Effect.Effect<A, E, NodeStatusTag>,
  ): Effect.Effect<A, NodeUnreachable> =>
    Effect.scoped(
      Effect.flatMap(Layer.build(clientLayer), (ctx) => Effect.provide(read, ctx)),
    ).pipe(Effect.mapError(toUnreachable));
  return {
    ping: oneShot(Effect.flatMap(NodeStatusTag, (h) => h.ping)),
    status: {
      get: oneShot(Effect.flatMap(NodeStatusTag, (h) => h.status.get)),
      changes: Stream.unwrap(Effect.map(NodeStatusTag, (h) => h.status.changes)).pipe(
        Stream.provide(clientLayer),
        Stream.mapError(toUnreachable),
      ),
    },
    logs: {
      stream: Stream.unwrap(Effect.map(NodeStatusTag, (h) => h.logs.stream)).pipe(
        Stream.provide(clientLayer),
        Stream.mapError(toUnreachable),
      ),
      query: (options) =>
        oneShot(Effect.flatMap(NodeStatusTag, (h) => h.logs.query(options))),
    },
  };
};

/** A status client for a node's `/rpc` url (ndjson/http) — internal dial helper (tests, url probes). @internal */
export const httpClient = (url: string): Layer.Layer<NodeStatusTag> =>
  Hyperlink.client(NodeStatusTag).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );

/** A status client for a specific addressed node (verify off — it IS the probe). @internal */
export const client = (node: AddressedNode<unknown>) =>
  Hyperlink.client(NodeStatusTag, node).pipe(
    Layer.provide(Hyperlink.clientVerify(false)),
  );
