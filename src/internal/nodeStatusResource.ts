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
import { LogStore } from "../store/log";

/** The reserved group id (wire prefix) for the node status resource. */
const HOST_STATUS_KEY = "@pm/node-status";

/** How often the live {@link NodeStatusResource} `status` stream re-emits a snapshot. */
const STATUS_INTERVAL = Duration.seconds(2);

/**
 * One served resource's readiness, as the node reports it — its wire key, {@link Resource.kindOf}
 * kind, whether it's ready, and (when not) why. The element of {@link nodeStatus}'s `resources`.
 * @since 1.0.0
 */
export const nodeResourceReadiness = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  ready: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
});

/** A served resource's readiness as reported by its node. @since 1.0.0 */
export type NodeResourceReadiness = typeof nodeResourceReadiness.Type;

/**
 * A node's live status — whether it's up, its overall readiness rollup, when it started, how long
 * it's been up, how many resources it serves, and each resource's readiness. `status` is `degraded`
 * (and `/health` returns 503) when any served resource is not ready. @since 1.0.0
 */
export const nodeStatus = Schema.Struct({
  up: Schema.Boolean,
  status: Schema.Literals(["ok", "degraded"]),
  startedAt: Schema.DateTimeUtc,
  uptimeMillis: Schema.Number,
  resourceCount: Schema.Number,
  resources: Schema.Array(nodeResourceReadiness),
});

/** Live node status. @since 1.0.0 */
export type NodeStatus = typeof nodeStatus.Type;

/**
 * The reserved node status resource tag — nodeless, so a client queries it over whichever node
 * transport it points the ambient `RpcClient.Protocol` at. @since 1.0.0
 */
export class NodeStatusResource extends Resource.Tag<NodeStatusResource>()(
  HOST_STATUS_KEY,
  {
  status: Resource.stream(nodeStatus).annotate({
    description: "Live node status (up / uptime / resource count), re-emitted periodically.",
  }),
  statusNow: Resource.effect(nodeStatus).annotate({
    description: "One-shot node status snapshot.",
  }),
  ping: Resource.effect(Schema.Number).annotate({
    description: "Server epoch milliseconds — a round-trip liveness probe.",
  }),
  logs: Resource.stream(LogEntrySchema).annotate({
    description: "Runtime-wide node log stream (recent tail, then live). Empty unless NodeLogs.layer is provided.",
  }),
  logHistory: Resource.effect(Schema.Array(LogEntrySchema), {
    payload: { limit: Schema.Number },
  }).annotate({
    description: "Replay persisted node logs (newest `limit`). Empty unless a HistoryStore is provided.",
  }),
}) {}

/** Build the node status service implementation for a node that started at `startedAt` and serves
 *  `resourceCount` resources. Logs/history are optional (read via `serviceOption`), so this adds no
 *  requirement to the server layer. @since 1.0.0 */
export const buildNodeStatusImpl = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  /** Per-resource readiness aggregate (same one `/health` reads); absent ⇒ no resources, `ok`. */
  readonly readiness?: Effect.Effect<ReadonlyArray<NodeResourceReadiness>>;
}) => {
  const readiness = options.readiness ?? Effect.succeed([]);
  const statusNow: Effect.Effect<NodeStatus> = Effect.gen(function* () {
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
  return {
    statusNow,
    status: Stream.tick(STATUS_INTERVAL).pipe(Stream.mapEffect(() => statusNow)),
    ping: Clock.currentTimeMillis,
    logs: Stream.unwrap(
      Effect.gen(function* () {
        const relay = yield* Effect.serviceOption(LogRelay);
        if (Option.isNone(relay)) return Stream.empty;
        const tail = yield* relay.value.snapshot;
        return Stream.concat(Stream.fromIterable(tail), relay.value.stream);
      }),
    ),
    // this node's durable logs (its own LogStore holds only its lines). Optional — `[]` when no
    // LogStore is composed. Newest first.
    logHistory: (payload: { readonly limit: number }) =>
      Effect.serviceOption(LogStore).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed<ReadonlyArray<LogEntry>>([]),
            onSome: (store) =>
              store
                .load({ limit: payload.limit, sort: "desc" })
                .pipe(Effect.catch(() => Effect.succeed<ReadonlyArray<LogEntry>>([]))),
          }),
        ),
      ),
  };
};

/**
 * The reserved node-status resource paired with its built impl — the `{ tag, impl }` that
 * {@link Resource.httpServer} folds onto every node's `RpcServer` automatically, so every node
 * exposes its status + logs without the author wiring it. @since 1.0.0
 */
export const nodeStatusServeEntry = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  readonly readiness?: Effect.Effect<ReadonlyArray<NodeResourceReadiness>>;
}): {
  readonly tag: typeof NodeStatusResource;
  readonly impl: ReturnType<typeof buildNodeStatusImpl>;
} => ({
  tag: NodeStatusResource,
  impl: buildNodeStatusImpl(options),
});
