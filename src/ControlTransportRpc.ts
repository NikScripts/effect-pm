/**
 * Effect RPC adapter for the transport-neutral control protocol.
 *
 * @remarks
 * `ControlTransportRpc` models one RPC operation, `Control.Dispatch`, over the
 * existing {@link ControlProtocolRequestEnvelope}. The adapter owns RPC framing
 * and adapter-specific failures; {@link ControlRouter} remains the only service
 * that interprets process and queue requests.
 *
 * This package currently targets Effect v4 beta, where RPC modules are exposed
 * from `effect/unstable/rpc`.
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
 * Schema-backed RPC adapter error.
 *
 * @remarks
 * Domain failures from processes and queues remain encoded as
 * {@link ControlProtocolResponseEnvelope} values. This error type is reserved
 * for failures introduced by the RPC adapter boundary.
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
 * Effect RPC server tuning exposed by the adapter.
 *
 * @remarks
 * Transport protocol selection remains in Effect RPC layers supplied by the
 * application, for example an HTTP, socket, worker, or test protocol.
 *
 * @public
 */
export interface ControlTransportRpcServerConfig {
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

const isControlRpcError = Schema.is(ControlRpcErrorSchema);

const errorMessage = (input: unknown): string => {
  if (
    typeof input === "object" &&
    input !== null &&
    "message" in input &&
    typeof input.message === "string"
  ) {
    return input.message;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "reason" in input &&
    typeof input.reason === "string"
  ) {
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
 * @remarks
 * The returned value satisfies {@link ControlTransportClientShape}, so it can
 * be passed directly to `ProcessManager.connect(Group, { transport })`.
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
    }),
});

/**
 * Build a {@link ControlTransportServerShape} backed by an externally supplied
 * Effect RPC server protocol.
 *
 * @remarks
 * Use this when composing with existing `ControlService.layer(group)` wiring.
 * Applications still choose and provide the concrete Effect RPC protocol at the
 * edge; this helper only adapts that protocol to `ControlTransportServer`.
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
