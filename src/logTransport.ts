/**
 * **logTransport** — live log stream transport using `RpcServer.Protocol`.
 *
 * @remarks
 * Live structured logs from `ProcessManagerLogRelay` are served via
 * `RpcServer.Protocol` on `/ws/log`. Durable log history remains in
 * `LogStore` and storage-backed query helpers; this transport handles
 * live relay stream and snapshot only.
 *
 * ## Architecture
 *
 * - **One RPC operation** — `Log.Stream` accepts a `LogStreamRequest` and
 *   returns a `Stream<ProcessManagerLogEntry>`.
 * - **Direct `RpcServer.Protocol`** — compose with
 *   `RpcServer.layerProtocolWebsocketRouter({ path: "/ws/log" })` +
 *   `RpcSerialization.layerNdjson`.
 *
 * @example Server
 * ```ts
 * logTransport.serverLayer().pipe(
 *   Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/log" })),
 *   Layer.provide(RpcSerialization.layerNdjson),
 *   Layer.provide(ProcessManagerLogRelay.layer),
 * )
 * ```
 *
 * @example Client
 * ```ts
 * const client = logTransport.makeClient(rpcClient)
 * const entries = client.stream({ follow: true, preludeLines: 100 })
 * ```
 *
 * @module logTransport
 */

import { Effect, Layer, Stream } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import type { ProcessManagerLogEntry } from "./LogEntry";
import {
  LogRpc,
  LogRpcErrorSchema,
  LogStreamRequestSchema,
  LogStreamScopeSchema,
  LogTransportClient,
  LogTransportRpcLive,
  makeLogTransportRpcClient,
  makeLogTransportRpcServer,
  type LogRpcClient,
  type LogRpcServerProtocol,
  type LogStreamRequest,
  type LogStreamScope,
  type LogTransportRpcServerConfig,
} from "./LogTransportRpc";
import type { ProcessManagerLogRelay } from "./Logs";

export {
  LogRpcErrorSchema,
  LogStreamRequestSchema,
  LogStreamScopeSchema,
  type LogStreamRequest,
  type LogStreamScope,
  type LogRpcClient,
  type LogRpcServerProtocol,
  type LogTransportRpcServerConfig,
};

/**
 * Derive the log transport WebSocket URL from a control-plane HTTP base URL.
 *
 * @remarks
 * Control REST routes and log transport share the same origin; only the path
 * switches from `/status`, `/contract`, etc. to `/ws/log`.
 *
 * @public
 */
export const logTransportWebSocketUrl = (baseUrl: string): string => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (normalized.startsWith("http://")) {
    return `${normalized.replace(/^http:/, "ws:")}/ws/log`;
  }
  if (normalized.startsWith("https://")) {
    return `${normalized.replace(/^https:/, "wss:")}/ws/log`;
  }
  return `${normalized}/ws/log`;
};

/**
 * Live log stream client shape for transport consumers.
 *
 * @public
 */
export interface LogTransportClientShape {
  readonly stream: (
    request: LogStreamRequest,
  ) => Stream.Stream<ProcessManagerLogEntry, unknown>;
}

/**
 * Public API namespace for the log transport.
 *
 * @remarks
 * `serverLayer` returns `Layer<never, never, ...>` (not `Layer<LogTransportServer, ...>`)
 * because no `LogTransportServer` service tag exists — the log server is purely
 * side-effect-driven (handlers are registered on the protocol; no downstream Effect
 * service consumes the server handle).  This is intentional, not a bug.
 *
 * @public
 */
export interface LogTransportApi {
  readonly serverLayer: (
    config?: LogTransportRpcServerConfig,
  ) => Layer.Layer<never, never, RpcServer.Protocol | ProcessManagerLogRelay>;

  readonly makeClient: typeof makeLogTransportRpcClient;
  readonly server: typeof makeLogTransportRpcServer;
  readonly makeServer: typeof makeLogTransportRpcServer;
  readonly rpc: typeof LogRpc;
  readonly live: typeof LogTransportRpcLive;

  readonly clientLayer: (
    client: LogRpcClient,
  ) => Layer.Layer<LogTransportClient>;

  readonly errors: {
    readonly Schema: typeof LogRpcErrorSchema;
  };
}

/** @public */
export const logTransport: LogTransportApi = {
  serverLayer: (
    config: LogTransportRpcServerConfig = {},
  ): Layer.Layer<never, never, RpcServer.Protocol | ProcessManagerLogRelay> =>
    Layer.effectDiscard(
      Effect.flatMap(RpcServer.Protocol, (protocol) =>
        makeLogTransportRpcServer(protocol, config),
      ),
    ),

  makeClient: makeLogTransportRpcClient,

  server: makeLogTransportRpcServer,
  makeServer: makeLogTransportRpcServer,

  rpc: LogRpc,

  live: LogTransportRpcLive,

  clientLayer: (
    client: LogRpcClient,
  ): Layer.Layer<LogTransportClient> =>
    Layer.succeed(LogTransportClient, makeLogTransportRpcClient(client)),

  errors: {
    Schema: LogRpcErrorSchema,
  },
};
