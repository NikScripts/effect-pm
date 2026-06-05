/**
 * **controlTransport** — group control dispatch transport using `RpcServer.Protocol`.
 *
 * @remarks
 * `ControlProtocol` request envelopes are dispatched to `ControlRouter`
 * via a single RPC operation `Control.Dispatch`. The transport provides
 * a `serverLayer` requiring `RpcServer.Protocol` from context, matching
 * the `storeTransport` and `logTransport` pattern.
 *
 * ## Architecture
 *
 * - **One RPC operation** — `Control.Dispatch` accepts a
 *   `ControlProtocolRequestEnvelope` and returns a
 *   `ControlProtocolResponseEnvelope`.
 * - **Direct `RpcServer.Protocol`** — compose with
 *   `RpcServer.layerProtocolWebsocketRouter({ path: "/ws/control" })` +
 *   `RpcSerialization.layerNdjson`.
 *
 * @example Server
 * ```ts
 * controlTransport.serverLayer().pipe(
 *   Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/control" })),
 *   Layer.provide(RpcSerialization.layerNdjson),
 *   Layer.provide(ControlRouter.layer),
 * )
 * ```
 *
 * @example Client
 * ```ts
 * const client = controlTransport.makeClient(rpcClient)
 * const response = yield* client.request(envelope)
 * ```
 *
 * @module controlTransport
 */

import { Effect, Layer } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import {
  ControlRpc,
  ControlRpcErrorSchema,
  ControlTransportRpcLive,
  controlRpcErrorFromTransportError,
  makeControlTransportRpcClient,
  makeControlTransportRpcServer,
  rpcErrorToControlTransportError,
  type ControlRpcClient,
  type ControlRpcServerProtocol,
  type ControlTransportRpcServerConfig,
} from "./ControlTransportRpc";
import {
  ControlTransportClient,
  ControlTransportServer,
} from "./ControlProtocol";

export {
  ControlRpcErrorSchema,
  controlRpcErrorFromTransportError,
  rpcErrorToControlTransportError,
  type ControlRpcClient,
  type ControlRpcServerProtocol,
  type ControlTransportRpcServerConfig,
};

/**
 * Public API namespace for the control transport.
 *
 * @public
 */
export interface ControlTransportApi {
  readonly serverLayer: (
    config?: ControlTransportRpcServerConfig,
  ) => Layer.Layer<
    ControlTransportServer,
    never,
    RpcServer.Protocol
  >;

  readonly makeClient: typeof makeControlTransportRpcClient;
  readonly rpc: typeof ControlRpc;
  readonly live: typeof ControlTransportRpcLive;

  readonly clientLayer: (
    client: ControlRpcClient,
  ) => Layer.Layer<ControlTransportClient>;

  readonly errors: {
    readonly Schema: typeof ControlRpcErrorSchema;
  };
}

/** @public */
export const controlTransport: ControlTransportApi = {
  serverLayer: (
    config: ControlTransportRpcServerConfig = {},
  ): Layer.Layer<ControlTransportServer, never, RpcServer.Protocol> =>
    Layer.effect(
      ControlTransportServer,
      Effect.map(RpcServer.Protocol, (protocol) =>
        makeControlTransportRpcServer(protocol, config),
      ),
    ),

  makeClient: makeControlTransportRpcClient,

  rpc: ControlRpc,

  live: ControlTransportRpcLive,

  clientLayer: (
    client: ControlRpcClient,
  ): Layer.Layer<ControlTransportClient> =>
    Layer.succeed(ControlTransportClient, makeControlTransportRpcClient(client)),

  errors: {
    Schema: ControlRpcErrorSchema,
  },
};
