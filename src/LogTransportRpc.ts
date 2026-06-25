/**
 * Effect RPC adapter for live process-manager logs.
 *
 * @remarks
 * `LogTransportRpc` is the streaming transport for the existing structured log
 * relay. It exposes semantic log stream input (`follow`, `preludeLines`, and
 * optional group/process/queue scope) and delegates all live data to
 * {@link ProcessManagerLogRelay}. Durable history remains owned by `LogStore`
 * and storage-backed query helpers.
 *
 * This package currently targets Effect v4 beta, where RPC modules are exposed
 * from `effect/unstable/rpc`.
 *
 * @module LogTransportRpc
 */

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect";
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc";
import {
  ProcessManagerLogEntrySchema,
  type ProcessManagerLogEntry,
} from "./LogEntry";
import {
  ProcessManagerLogRelay,
  type ProcessManagerLogRelayService,
} from "./Logs";
import {
  logEntryMatchesScope,
  type ProcessManagerLogScope,
} from "./internal/manager/logScope";

const defaultPreludeLines = 100;
const maxPreludeLines = 500;

/**
 * Schema-backed RPC adapter error for live log streaming.
 *
 * @remarks
 * Missing relay services, malformed adapter input, or concrete RPC protocol
 * failures map to this transport error. Log entries themselves remain domain
 * values and are not wrapped in transport envelopes.
 *
 * @public
 */
export const LogRpcErrorSchema = Schema.TaggedStruct("LogRpcError", {
  reason: Schema.String,
});

/** @public */
export type LogRpcError = typeof LogRpcErrorSchema.Type;

/**
 * Semantic scope for live log streaming.
 *
 * @public
 */
export const LogStreamScopeSchema = Schema.Union([
  Schema.TaggedStruct("all", {}),
  Schema.TaggedStruct("group", {
    groupId: Schema.String,
  }),
  Schema.TaggedStruct("process", {
    groupId: Schema.String,
    processId: Schema.String,
  }),
  Schema.TaggedStruct("queue", {
    groupId: Schema.String,
    queueId: Schema.String,
  }),
]);

/** @public */
export type LogStreamScope = typeof LogStreamScopeSchema.Type;

/**
 * Semantic live log stream input.
 *
 * @remarks
 * This input intentionally avoids HTTP query parameter names or NDJSON details.
 * `preludeLines` selects recent in-memory relay history before live entries.
 * `follow: false` returns only the prelude stream.
 *
 * @public
 */
export const LogStreamRequestSchema = Schema.Struct({
  follow: Schema.optional(Schema.Boolean),
  preludeLines: Schema.optional(Schema.Number),
  scope: Schema.optional(LogStreamScopeSchema),
});

/** @public */
export type LogStreamRequest = typeof LogStreamRequestSchema.Type;

/**
 * RPC group for live log streaming.
 *
 * @public
 */
export const LogRpc = RpcGroup.make(
  Rpc.make("Log.Stream", {
    payload: LogStreamRequestSchema,
    success: ProcessManagerLogEntrySchema,
    error: LogRpcErrorSchema,
    stream: true,
  }),
);

/** @public */
export type LogRpcClient<E = never> = RpcClient.FromGroup<typeof LogRpc, E>;

/** @public */
export type LogRpcServerProtocol = RpcServer.Protocol["Service"];

/**
 * Effect RPC server tuning exposed by the adapter.
 *
 * @public
 */
export interface LogTransportRpcServerConfig {
  /** Disable tracing spans created by Effect RPC server dispatch. */
  readonly disableTracing?: boolean;
  /** Span name prefix used by Effect RPC server dispatch. */
  readonly spanPrefix?: string;
  /** Extra attributes attached to Effect RPC server spans. */
  readonly spanAttributes?: Readonly<Record<string, unknown>>;
  /** Maximum concurrent RPC handler executions, or `"unbounded"`. */
  readonly concurrency?: number | "unbounded";
  /** Keep server defects inside the RPC response channel when supported. */
  readonly disableFatalDefects?: boolean;
}

/**
 * Minimal client shape for live log stream consumers.
 *
 * @public
 */
export interface LogTransportClientShape<Error = never, Requirements = never> {
  readonly stream: (
    request: LogStreamRequest,
  ) => Stream.Stream<ProcessManagerLogEntry, LogRpcError | Error, Requirements>;
}

/**
 * Injectable log stream client service for applications that prefer layer wiring.
 *
 * @public
 */
export class LogTransportClient extends Context.Service<
  LogTransportClient,
  LogTransportClientShape<unknown>
>()("@nikscripts/effect-pm/LogTransportRpc/LogTransportClient") {}

const clampPreludeLines = (lines: number | undefined): number => {
  const value = lines ?? defaultPreludeLines;
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value > maxPreludeLines ? maxPreludeLines : Math.trunc(value);
};

const requestScope = (
  request: LogStreamRequest,
): Option.Option<ProcessManagerLogScope> =>
  request.scope === undefined ? Option.none() : Option.some(request.scope);

const shouldEmit = (
  scope: Option.Option<ProcessManagerLogScope>,
) =>
  (entry: ProcessManagerLogEntry): boolean =>
    Option.match(scope, {
      onNone: () => true,
      onSome: (value) => logEntryMatchesScope(entry, value),
    });

const filtered = (
  stream: Stream.Stream<ProcessManagerLogEntry>,
  scope: Option.Option<ProcessManagerLogScope>,
): Stream.Stream<ProcessManagerLogEntry> =>
  stream.pipe(Stream.filter(shouldEmit(scope)));

const preludeStream = (
  relay: ProcessManagerLogRelayService,
  lines: number,
  scope: Option.Option<ProcessManagerLogScope>,
): Stream.Stream<ProcessManagerLogEntry> =>
  Stream.fromIterableEffect(
    relay.snapshot.pipe(
      Effect.map((entries) => entries.slice(Math.max(0, entries.length - lines))),
    ),
  ).pipe(Stream.filter(shouldEmit(scope)));

/**
 * Build the semantic stream served by the RPC handler.
 *
 * @remarks
 * The stream is deliberately relay-only: snapshot and live entries come from
 * `ProcessManagerLogRelay`. Storage-backed history stays in `LogStore` and
 * `logQuery` so this transport does not duplicate durable query behavior.
 *
 * @public
 */
export const makeLogStream = (
  request: LogStreamRequest,
): Effect.Effect<Stream.Stream<ProcessManagerLogEntry>, never, ProcessManagerLogRelay> =>
  Effect.map(ProcessManagerLogRelay, (relay) => {
    const scope = requestScope(request);
    const prelude = preludeStream(relay, clampPreludeLines(request.preludeLines), scope);
    return request.follow === false
      ? prelude
      : Stream.concat(prelude, filtered(relay.stream, scope));
  });

/**
 * Build a live log stream client from an Effect RPC client.
 *
 * @public
 */
export const makeLogTransportRpcClient = <E>(
  client: LogRpcClient<E>,
): LogTransportClientShape<E> => ({
  stream: (request) => client["Log.Stream"](request),
});

/**
 * Live log RPC handler layer.
 *
 * @public
 */
export const LogTransportRpcLive = LogRpc.toLayer({
  "Log.Stream": (request: LogStreamRequest) =>
    Stream.unwrap(makeLogStream(request)),
});

/**
 * Build an Effect RPC server effect for live logs.
 *
 * @public
 */
export const makeLogTransportRpcServer = (
  protocol: LogRpcServerProtocol,
  config: LogTransportRpcServerConfig = {},
): Effect.Effect<never, never, ProcessManagerLogRelay | Scope.Scope> =>
  // Build the handlers layer once into the server's scope (a Context, not a per-run Layer provide),
  // satisfying strictEffectProvide.
  Effect.gen(function* () {
    const handlers = yield* Layer.build(LogTransportRpcLive);
    return yield* RpcServer.make(LogRpc, config).pipe(
      Effect.provide(handlers),
      Effect.provideService(RpcServer.Protocol, protocol),
    );
  });

/**
 * Public helper namespace for live log Effect RPC transport.
 *
 * @public
 */
export interface LogTransportRpcApi {
  readonly rpc: typeof LogRpc;
  readonly client: typeof makeLogTransportRpcClient;
  readonly makeClient: typeof makeLogTransportRpcClient;
  readonly server: typeof makeLogTransportRpcServer;
  readonly makeServer: typeof makeLogTransportRpcServer;
  readonly live: typeof LogTransportRpcLive;
  readonly clientLayer: (
    client: LogRpcClient,
  ) => Layer.Layer<LogTransportClient>;
  readonly serverLayer: (
    config?: LogTransportRpcServerConfig,
  ) => Layer.Layer<never, never, RpcServer.Protocol | ProcessManagerLogRelay>;
}

/** @public */
export const LogTransportRpc: LogTransportRpcApi = {
  rpc: LogRpc,
  client: makeLogTransportRpcClient,
  makeClient: makeLogTransportRpcClient,
  server: makeLogTransportRpcServer,
  makeServer: makeLogTransportRpcServer,
  live: LogTransportRpcLive,
  clientLayer: (
    client: LogRpcClient,
  ): Layer.Layer<LogTransportClient> =>
    Layer.succeed(LogTransportClient, makeLogTransportRpcClient(client)),
  serverLayer: (
    config: LogTransportRpcServerConfig = {},
  ): Layer.Layer<never, never, RpcServer.Protocol | ProcessManagerLogRelay> =>
    Layer.effectDiscard(
      Effect.flatMap(RpcServer.Protocol, (protocol) =>
        makeLogTransportRpcServer(protocol, config)
      ),
    ),
};
