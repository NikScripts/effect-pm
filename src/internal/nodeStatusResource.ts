/**
 * @module internal/nodeStatusResource
 *
 * The reserved **node status** resource — every node that serves a group over
 * {@link Resource.httpServer} automatically also serves this, so a client can ask any node
 * "are you up, how long, how many resources, and what are your logs?" without the node author
 * wiring anything. It's a nodeless {@link Resource.Tag} (one reserved group id); a client reaches
 * a specific node by pointing the ambient transport at that node's url (see {@link NodeStatus}).
 *
 * Kept internal (not the public face) so {@link Resource} can dynamically import it from
 * `httpServer` without a static import cycle (`Resource` ⇄ this); `src/NodeStatus.ts` is the
 * public re-export.
 */
import {
  Clock,
  DateTime,
  Duration,
  Effect,
  Option,
  Schema,
  Stream,
} from "effect";
import * as Resource from "../Resource";
import { LogRelay } from "../Logs";
import { LogEntrySchema } from "../LogEntry";
import type { LogEntry } from "../LogEntry";
import { queryDurableNode } from "./logs/durableRead";

/** The reserved group id (wire prefix) for the node status resource. */
const HOST_STATUS_KEY = "@pm/node-status";

/** How often the live {@link NodeStatusResource} `status` stream re-emits a snapshot. */
const STATUS_INTERVAL = Duration.seconds(2);

/**
 * One served resource's readiness, as the node reports it — its wire key, {@link Resource.kindOf}
 * kind, whether it's ready, and (when not) why. The element of {@link nodeStatus}'s `resources`.
 */
export const nodeResourceReadiness = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  ready: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
});

/** A served resource's readiness as reported by its node. */
export type NodeResourceReadiness = typeof nodeResourceReadiness.Type;

/**
 * A node's live status — whether it's up, its overall readiness rollup, when it started, how long
 * it's been up, how many resources it serves, and each resource's readiness. `status` is `degraded`
 * (and `/health` returns 503) when any served resource is not ready.
 */
export const nodeStatus = Schema.Struct({
  up: Schema.Boolean,
  status: Schema.Literals(["ok", "degraded"]),
  startedAt: Schema.DateTimeUtc,
  uptimeMillis: Schema.Number,
  resourceCount: Schema.Number,
  resources: Schema.Array(nodeResourceReadiness),
});

/** Live node status. */
export type NodeStatus = typeof nodeStatus.Type;

/**
 * The reserved node status resource tag — nodeless, so a client queries it over whichever node
 * transport it points the ambient `RpcClient.Protocol` at.
 */
export class NodeStatusResource extends Resource.Tag<NodeStatusResource>()(
  HOST_STATUS_KEY,
  {
  status: Resource.ref(nodeStatus).annotate({
    description:
      "Live node status (up / uptime / resource count / per-resource readiness) — " +
      "`status.get` for one-shot, `status.changes` re-emitted periodically.",
  }),
  ping: Resource.effect(Schema.Number).annotate({
    description: "Server epoch milliseconds — a round-trip liveness probe.",
  }),
  logs: {
    stream: Resource.stream(LogEntrySchema).annotate({
      description:
        "Runtime-wide node log stream (recent tail, then live). Empty unless Logs.layer is provided.",
    }),
    query: Resource.effectFn({ limit: Schema.Number }, Schema.Array(LogEntrySchema)).annotate({
      description:
        "Replay persisted node logs (newest `limit`) from `Resource.store(Node)` / `Node.logs` " +
        "registration Storage. Empty when the node journal is not registered (or `nodeLogKey` unknown).",
    }),
  },
}) {}

/** Build the node status service implementation for a node that started at `startedAt` and serves
 *  `resourceCount` resources. Logs/history are optional (read via `serviceOption`), so this adds no
 *  requirement to the server layer. */
export const buildNodeStatusImpl = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  /** Per-resource readiness aggregate (same one `/health` reads); absent ⇒ no resources, `ok`. */
  readonly readiness?: Effect.Effect<ReadonlyArray<NodeResourceReadiness>>;
  /**
   * Node log key for durable `logs.query` via registration Storage (`Node.logs`).
   * When omitted, query returns `[]`.
   */
  readonly nodeLogKey?: string;
}) => {
  const readiness = options.readiness ?? Effect.succeed([]);
  const computeStatus: Effect.Effect<NodeStatus> = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const resources = yield* readiness;
    const ok = resources.every((r) => r.ready);
    const status: "ok" | "degraded" = ok ? "ok" : "degraded";
    return {
      up: true,
      status,
      startedAt: DateTime.makeUnsafe(options.startedAt),
      uptimeMillis: now - options.startedAt,
      resourceCount: options.resourceCount,
      resources,
    };
  });
  const statusSub: Resource.Subscribable<NodeStatus> = {
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
  return {
    status: statusSub,
    ping: Clock.currentTimeMillis,
    logs: {
      stream: logsLive,
      query: (payload: { readonly limit: number }) =>
        options.nodeLogKey !== undefined
          ? queryDurableNode(options.nodeLogKey, { limit: payload.limit })
          : Effect.succeed([] as ReadonlyArray<LogEntry>),
    },
  };
};

/**
 * The reserved node-status resource paired with its built impl — the `{ tag, impl }` that
 * {@link Resource.httpServer} folds onto every node's `RpcServer` automatically, so every node
 * exposes its status + logs without the author wiring it.
 */
export const nodeStatusServeEntry = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  readonly readiness?: Effect.Effect<ReadonlyArray<NodeResourceReadiness>>;
  readonly nodeLogKey?: string;
}): {
  readonly tag: typeof NodeStatusResource;
  readonly impl: ReturnType<typeof buildNodeStatusImpl>;
} => ({
  tag: NodeStatusResource,
  impl: buildNodeStatusImpl(options),
});
