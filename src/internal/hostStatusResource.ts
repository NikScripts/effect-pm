/**
 * @module internal/hostStatusResource
 *
 * The reserved **host status** resource — every host that serves a group over
 * {@link Resource.serveAllHttp} automatically also serves this, so a client can ask any host
 * "are you up, how long, how many resources, and what are your logs?" without the host author
 * wiring anything. It's a hostless {@link Resource.Tag} (one reserved group id); a client reaches
 * a specific host by pointing the ambient transport at that host's url (see {@link HostStatus}).
 *
 * Kept internal (not the public face) so {@link Resource} can dynamically import it from
 * `serveAllHttp` without a static import cycle (`Resource` ⇄ this); `src/HostStatus.ts` is the
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
import type { ServeEntry } from "../Resource";
import { LogRelay } from "../Logs";
import { LogEntrySchema } from "../LogEntry";
import { history as hostLogsHistory } from "../HostLogs";

/** The reserved group id (wire prefix) for the host status resource. */
const HOST_STATUS_KEY = "@pm/host-status";

/** How often the live {@link HostStatusResource} `status` stream re-emits a snapshot. */
const STATUS_INTERVAL = Duration.seconds(2);

/**
 * One served resource's readiness, as the host reports it — its wire key, {@link Resource.kindOf}
 * kind, whether it's ready, and (when not) why. The element of {@link hostStatus}'s `resources`.
 * @since 1.0.0
 */
export const hostResourceReadiness = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  ready: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
});

/** A served resource's readiness as reported by its host. @since 1.0.0 */
export type HostResourceReadiness = typeof hostResourceReadiness.Type;

/**
 * A host's live status — whether it's up, its overall readiness rollup, when it started, how long
 * it's been up, how many resources it serves, and each resource's readiness. `status` is `degraded`
 * (and `/health` returns 503) when any served resource is not ready. @since 1.0.0
 */
export const hostStatus = Schema.Struct({
  up: Schema.Boolean,
  status: Schema.Literals(["ok", "degraded"]),
  startedAt: Schema.DateTimeUtc,
  uptimeMillis: Schema.Number,
  resourceCount: Schema.Number,
  resources: Schema.Array(hostResourceReadiness),
});

/** Live host status. @since 1.0.0 */
export type HostStatus = typeof hostStatus.Type;

/**
 * The reserved host status resource tag — hostless, so a client queries it over whichever host
 * transport it points the ambient `RpcClient.Protocol` at. @since 1.0.0
 */
export class HostStatusResource extends Resource.Tag<HostStatusResource>()(
  HOST_STATUS_KEY,
  {
  status: Resource.stream(hostStatus).annotate({
    description: "Live host status (up / uptime / resource count), re-emitted periodically.",
  }),
  statusNow: Resource.query(hostStatus).annotate({
    description: "One-shot host status snapshot.",
  }),
  ping: Resource.query(Schema.Number).annotate({
    description: "Server epoch milliseconds — a round-trip liveness probe.",
  }),
  logs: Resource.stream(LogEntrySchema).annotate({
    description: "Runtime-wide host log stream (recent tail, then live). Empty unless HostLogs.layer is provided.",
  }),
  logHistory: Resource.query(Schema.Array(LogEntrySchema), {
    payload: { limit: Schema.Number },
  }).annotate({
    description: "Replay persisted host logs (newest `limit`). Empty unless a HistoryStore is provided.",
  }),
}) {}

/** Build the host status service implementation for a host that started at `startedAt` and serves
 *  `resourceCount` resources. Logs/history are optional (read via `serviceOption`), so this adds no
 *  requirement to the server layer. @since 1.0.0 */
export const buildHostStatusImpl = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  /** Per-resource readiness aggregate (same one `/health` reads); absent ⇒ no resources, `ok`. */
  readonly readiness?: Effect.Effect<ReadonlyArray<HostResourceReadiness>>;
}) => {
  const readiness = options.readiness ?? Effect.succeed([]);
  const statusNow: Effect.Effect<HostStatus> = Effect.gen(function* () {
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
    logHistory: (payload: { readonly limit: number }) =>
      hostLogsHistory({ limit: payload.limit }),
  };
};

/**
 * A {@link Resource.serveAllHttp} entry that serves the reserved host status resource — appended
 * automatically by `serveAllHttp` so every host exposes its status + logs. @since 1.0.0
 */
export const hostStatusServeEntry = (options: {
  readonly startedAt: number;
  readonly resourceCount: number;
  readonly readiness?: Effect.Effect<ReadonlyArray<HostResourceReadiness>>;
}): ServeEntry => ({
  tag: HostStatusResource,
  impl: buildHostStatusImpl(options),
});
