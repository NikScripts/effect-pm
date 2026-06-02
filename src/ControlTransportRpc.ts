/**
 * Effect RPC adapter for the transport-neutral control protocol.
 *
 * @module ControlTransportRpc
 */

import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc";
import {
  ControlProtocolRequestEnvelopeSchema,
  ControlProtocolResponseEnvelopeSchema,
  ControlRouter,
  ControlTransportClient,
  ControlTransportError,
  ControlTransportServer,
  makeControlProtocolResponseEnvelope,
  type ControlProtocolRequestEnvelope,
  type ControlTransportClientShape,
  type ControlTransportServerShape,
} from "./ControlProtocol";

/**
 * Schema-backed RPC adapter error. Domain control handlers continue returning
 * protocol envelopes; this DTO is only for RPC framing/client failures.
 *
 * @public
 */
export const ControlRpcErrorSchema = Schema.TaggedStruct("ControlRpcError", {
  reason: Schema.String,
  status: Schema.optional(Schema.Number),
});

/** @public */
export type ControlRpcError = typeof ControlRpcErrorSchema.Type;

/**
 * RPC group for dispatching existing {@link ControlProtocolRequestEnvelope}
 * values without adding new domain request types.
 *
 * @public
 */
export const ControlRpc = RpcGroup.make(
  Rpc.make("Control.Dispatch", {
    payload: ControlProtocolRequestEnvelopeSchema,
    success: ControlProtocolResponseEnvelopeSchema,
    error: ControlRpcErrorSchema,
  }),
);

/** @public */
export type ControlRpcClient<E = never> = RpcClient.FromGroup<typeof ControlRpc, E>;

/**
 * Effect RPC server tuning exposed by the adapter. Transport protocol selection
 * remains in Effect RPC layers supplied by the application.
 *
 * @public
 */
export interface ControlTransportRpcServerConfig {
  readonly disableTracing?: boolean;
  readonly spanPrefix?: string;
  readonly spanAttributes?: Readonly<Record<string, unknown>>;
  readonly concurrency?: number | "unbounded";
  readonly disableFatalDefects?: boolean;
}

const makeControlRpcError = (
  reason: string,
  status?: number,
): ControlRpcError => ({
  _tag: "ControlRpcError",
  reason,
  ...(status === undefined ? {} : { status }),
});

/** @public */
export const controlRpcErrorFromTransportError = (
  error: ControlTransportError,
): ControlRpcError => makeControlRpcError(error.reason, error.status);

const hasProperty = <Key extends PropertyKey>(
  input: unknown,
  key: Key,
): input is { readonly [K in Key]: unknown } =>
  typeof input === "object" && input !== null && key in input;

const isControlRpcError = (input: unknown): input is ControlRpcError =>
  hasProperty(input, "_tag") &&
  input._tag === "ControlRpcError" &&
  hasProperty(input, "reason") &&
  typeof input.reason === "string" &&
  (!hasProperty(input, "status") || typeof input.status === "number");

const errorMessage = (input: unknown): string => {
  if (hasProperty(input, "message") && typeof input.message === "string") {
    return input.message;
  }
  if (hasProperty(input, "reason") && typeof input.reason === "string") {
    return input.reason;
  }
  return String(input);
};

/** @public */
export const rpcErrorToControlTransportError = (
  error: unknown,
): ControlTransportError =>
  isControlRpcError(error)
    ? new ControlTransportError({
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
      })
    : new ControlTransportError({
        reason: errorMessage(error),
      });

/**
 * Build a control transport client from an Effect RPC client.
 *
 * @public
 */
export const makeControlTransportRpcClient = <E>(
  client: ControlRpcClient<E>,
): ControlTransportClientShape => ({
  request: (envelope) =>
    client["Control.Dispatch"](envelope).pipe(
      Effect.mapError(rpcErrorToControlTransportError),
    ),
});

/**
 * Control RPC handler layer. It delegates only to {@link ControlRouter}; process
 * and queue routing stay in the existing transport-neutral router.
 *
 * @public
 */
export const ControlTransportRpcLive = ControlRpc.toLayer({
  "Control.Dispatch": (envelope: ControlProtocolRequestEnvelope) =>
    Effect.gen(function* () {
      const router = yield* ControlRouter;
      const response = yield* router.handle(envelope.request);
      return yield* makeControlProtocolResponseEnvelope(envelope, response);
    }).pipe(
      Effect.mapError(controlRpcErrorFromTransportError),
    ),
});

/**
 * Build a {@link ControlTransportServerShape} backed by an externally supplied
 * Effect RPC server protocol.
 *
 * @public
 */
export const makeControlTransportRpcServer = (
  protocol: RpcServer.Protocol["Service"],
  config: ControlTransportRpcServerConfig = {},
): ControlTransportServerShape => ({
  serve: RpcServer.make(ControlRpc, config).pipe(
    Effect.provide(ControlTransportRpcLive),
    Effect.provideService(RpcServer.Protocol, protocol),
    Effect.asVoid,
  ),
});

/**
 * Effect RPC control transport helpers.
 *
 * @public
 */
export const ControlTransportRpc = {
  rpc: ControlRpc,
  client: makeControlTransportRpcClient,
  makeClient: makeControlTransportRpcClient,
  server: makeControlTransportRpcServer,
  makeServer: makeControlTransportRpcServer,
  live: ControlTransportRpcLive,
  clientLayer: <E>(
    client: ControlRpcClient<E>,
  ): Layer.Layer<ControlTransportClient> =>
    Layer.succeed(ControlTransportClient, makeControlTransportRpcClient(client)),
  serverLayer: (
    config: ControlTransportRpcServerConfig = {},
  ): Layer.Layer<ControlTransportServer, never, RpcServer.Protocol> =>
    Layer.effect(
      ControlTransportServer,
      Effect.map(RpcServer.Protocol, (protocol) =>
        makeControlTransportRpcServer(protocol, config)
      ),
    ),
} as const;
