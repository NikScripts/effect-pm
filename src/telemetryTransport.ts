/**
 * **telemetryTransport** — live facet telemetry stream over Effect RPC.
 *
 * @remarks
 * Subscribes to {@link TelemetryBroadcast} (fed by {@link BroadcastSink} at hub
 * compose time). Durable history remains on archive facets via
 * {@link storeTransport | storeTransport} — this transport is push-only on emit.
 *
 * Path: `/ws/telemetry` when mounted with `RpcServer.layerProtocolWebsocket`.
 *
 * @module telemetryTransport
 */

import { Context, Effect, Layer, Schema, Stream } from "effect";
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc";
import { TelemetryBroadcast } from "./sink/BroadcastSink";
import type { TelemetryHubEmitted } from "./TelemetryHub";

/** Schema-backed telemetry stream item (wire + decoded payload). @public */
export const TelemetryEventItemSchema = Schema.Struct({
  wire: Schema.String,
  payload: Schema.Unknown,
});

/** @public */
export type TelemetryEventItem = typeof TelemetryEventItemSchema.Type;

/** Live telemetry subscription input. @public */
export const TelemetryStreamRequestSchema = Schema.Struct({
  wires: Schema.optional(Schema.Array(Schema.String)),
});

/** @public */
export type TelemetryStreamRequest = typeof TelemetryStreamRequestSchema.Type;

/** @public */
export const TelemetryRpcErrorSchema = Schema.TaggedStruct("TelemetryRpcError", {
  reason: Schema.String,
});

/** @public */
export type TelemetryRpcError = typeof TelemetryRpcErrorSchema.Type;

/** @public */
export const TelemetryRpc = RpcGroup.make(
  Rpc.make("Telemetry.Stream", {
    payload: TelemetryStreamRequestSchema,
    success: TelemetryEventItemSchema,
    error: TelemetryRpcErrorSchema,
    stream: true,
  }),
);

/** @public */
export type TelemetryRpcClient<E = never> = RpcClient.FromGroup<typeof TelemetryRpc, E>;

/** @public */
export type TelemetryRpcServerProtocol = RpcServer.Protocol["Service"];

/** @public */
export interface TelemetryTransportServerConfig {
  readonly disableTracing?: boolean | undefined;
  readonly spanPrefix?: string | undefined;
  readonly spanAttributes?: Readonly<Record<string, unknown>> | undefined;
  readonly concurrency?: number | "unbounded" | undefined;
  readonly disableFatalDefects?: boolean | undefined;
}

/** @public */
export interface TelemetryTransportClientShape<
  Error = never,
  Requirements = never,
> {
  readonly stream: (
    request: TelemetryStreamRequest,
  ) => Stream.Stream<TelemetryEventItem, TelemetryRpcError | Error, Requirements>;
}

/** @public */
export class TelemetryTransportClient extends Context.Service<
  TelemetryTransportClient,
  TelemetryTransportClientShape<unknown>
>()("@nikscripts/effect-pm/telemetryTransport/TelemetryTransportClient") {}

const toItem = (event: TelemetryHubEmitted): TelemetryEventItem => ({
  wire: event.wire,
  payload: event.payload,
});

/**
 * Build the semantic stream served by the RPC handler.
 *
 * @public
 */
export const makeTelemetryStream = (
  request: TelemetryStreamRequest,
): Effect.Effect<
  Stream.Stream<TelemetryEventItem>,
  never,
  TelemetryBroadcast
> =>
  Effect.map(TelemetryBroadcast, (broadcast) =>
    broadcast.stream(request.wires).pipe(Stream.map(toItem)),
  );

/** @public */
export const makeTelemetryTransportClient = <E>(
  client: TelemetryRpcClient<E>,
): TelemetryTransportClientShape<E> => ({
  stream: (request) => client["Telemetry.Stream"](request),
});

/** @public */
export const TelemetryTransportLive = TelemetryRpc.toLayer({
  "Telemetry.Stream": (request: TelemetryStreamRequest) =>
    Stream.unwrap(makeTelemetryStream(request)),
});

/** @public */
export const makeTelemetryTransportServer = (
  protocol: TelemetryRpcServerProtocol,
  config: TelemetryTransportServerConfig = {},
): Effect.Effect<never, never, TelemetryBroadcast> =>
  RpcServer.make(TelemetryRpc, config).pipe(
    Effect.provide(TelemetryTransportLive),
    Effect.provideService(RpcServer.Protocol, protocol),
  );

/** @public */
export interface TelemetryTransportApi {
  readonly rpc: typeof TelemetryRpc;
  readonly makeClient: typeof makeTelemetryTransportClient;
  readonly makeStream: typeof makeTelemetryStream;
  readonly makeTelemetryStream: typeof makeTelemetryStream;
  readonly server: typeof makeTelemetryTransportServer;
  readonly live: typeof TelemetryTransportLive;
  readonly clientLayer: (
    client: TelemetryRpcClient,
  ) => Layer.Layer<TelemetryTransportClient>;
  readonly serverLayer: (
    config?: TelemetryTransportServerConfig,
  ) => Layer.Layer<never, never, RpcServer.Protocol | TelemetryBroadcast>;
}

/** @public */
export const telemetryTransport: TelemetryTransportApi = {
  rpc: TelemetryRpc,
  makeClient: makeTelemetryTransportClient,
  makeStream: makeTelemetryStream,
  makeTelemetryStream,
  server: makeTelemetryTransportServer,
  live: TelemetryTransportLive,
  clientLayer: (
    client: TelemetryRpcClient,
  ): Layer.Layer<TelemetryTransportClient> =>
    Layer.succeed(
      TelemetryTransportClient,
      makeTelemetryTransportClient(client),
    ),
  serverLayer: (
    config: TelemetryTransportServerConfig = {},
  ): Layer.Layer<never, never, RpcServer.Protocol | TelemetryBroadcast> =>
    Layer.effectDiscard(
      Effect.flatMap(RpcServer.Protocol, (protocol) =>
        makeTelemetryTransportServer(protocol, config),
      ),
    ),
};
