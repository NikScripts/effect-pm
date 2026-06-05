/**
 * **terminalTransport** — remote terminal session transport using `RpcServer.Protocol`.
 *
 * @remarks
 * Terminal sessions are opened, resized, fed input, streamed events, and
 * closed through `RpcServer.Protocol` on path `/ws/terminal`.  Session
 * state (handles by ID) is managed in-server; the wire carries only
 * `sessionId` for input/resize/close/events.
 *
 * ## Architecture
 *
 * - **Five RPC operations** — `Open`, `Input`, `Resize`, `Close`, `Events`
 *   defined by {@link TerminalRpcGroup}.
 * - **Direct `RpcServer.Protocol`** — compose with
 *   `RpcServer.layerProtocolWebsocketRouter({ path: "/ws/terminal" })` +
 *   `RpcSerialization.layerNdjson`.
 * - **Siloed from control** — no imports from TelemetryHub, archive facets,
 *   or hub sinks.
 *
 * @example Server
 * ```ts
 * terminalTransport.serverLayer().pipe(
 *   Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/terminal" })),
 *   Layer.provide(RpcSerialization.layerNdjson),
 *   Layer.provide(TerminalSessionService.layer),
 * )
 * ```
 *
 * @module terminalTransport
 */

import { Effect, Layer, Stream } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import {
  TerminalRpcGroup,
} from "./TerminalRpc";
import {
  OpenTerminalSessionSchema,
  TerminalEventSchema,
  TerminalSessionError,
  TerminalSessionErrorSchema,
  TerminalSessionIdSchema,
  TerminalSessionService,
  type OpenTerminalSession,
  type TerminalSessionId,
} from "./Terminal";

// ============================================================================
// Server handler layer — delegates to TerminalSessionService
// ============================================================================

/**
 * Handler layer for terminal RPC operations.
 *
 * Each call carries a `sessionId`; the handler maintains an in-memory
 * lookup of open sessions.  Session handles are removed on `Close`.
 *
 * @internal
 */
const TerminalTransportLive = TerminalRpcGroup.toLayer({
  "Terminal.Open": (input: OpenTerminalSession) =>
    Effect.flatMap(TerminalSessionService, (service) =>
      service.open(input),
    ).pipe(
      Effect.map((handle) => {
        sessionHandles.set(handle.sessionId, handle);
        return { sessionId: handle.sessionId };
      }),
    ),

  "Terminal.Input": ({ sessionId, chunk }: {
    readonly sessionId: string;
    readonly chunk: Uint8Array;
  }) =>
    Effect.gen(function* () {
      const handle = sessionHandles.get(sessionId);
      if (handle === undefined) {
        return yield* new TerminalSessionError({
          reason: `Session ${sessionId} not found`,
        });
      }
      return yield* handle.input(chunk);
    }),

  "Terminal.Resize": ({ sessionId, cols, rows }: {
    readonly sessionId: string;
    readonly cols: number;
    readonly rows: number;
  }) =>
    Effect.gen(function* () {
      const handle = sessionHandles.get(sessionId);
      if (handle === undefined) {
        return yield* new TerminalSessionError({
          reason: `Session ${sessionId} not found`,
        });
      }
      return yield* handle.resize({ cols, rows });
    }),

  "Terminal.Close": ({ sessionId }: { readonly sessionId: string }) =>
    Effect.gen(function* () {
      const handle = sessionHandles.get(sessionId);
      if (handle === undefined) {
        return yield* new TerminalSessionError({
          reason: `Session ${sessionId} not found`,
        });
      }
      yield* handle.close;
      sessionHandles.delete(sessionId);
    }),

  "Terminal.Events": ({ sessionId }: { readonly sessionId: string }) => {
    const handle = sessionHandles.get(sessionId);
    if (handle === undefined) {
      return Stream.fail(
        new TerminalSessionError({
          reason: `Session ${sessionId} not found`,
        }),
      );
    }
    return handle.events;
  },
});

// ============================================================================
// Session handle registry
// ============================================================================

/** In-memory session handle lookup.  Cleared per-Protocol lifecycle. */
const sessionHandles = new Map<
  string,
  import("./Terminal").TerminalSessionHandle
>();

// ============================================================================
// Public API
// ============================================================================

export {
  TerminalRpcGroup,
  OpenTerminalSessionSchema,
  TerminalEventSchema,
  TerminalSessionErrorSchema,
  TerminalSessionIdSchema,
};

export type { OpenTerminalSession, TerminalSessionId };

/**
 * Public API namespace for the terminal transport.
 *
 * @public
 */
export interface TerminalTransportApi {
  readonly rpc: typeof TerminalRpcGroup;
  readonly serverLayer: (
    config?: {
      readonly disableTracing?: boolean;
    },
  ) => Layer.Layer<never, never, RpcServer.Protocol | TerminalSessionService>;
}

/** @public */
export const terminalTransport: TerminalTransportApi = {
  rpc: TerminalRpcGroup,

  serverLayer: (config = {}): Layer.Layer<
    never,
    never,
    RpcServer.Protocol | TerminalSessionService
  > =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const protocol = yield* RpcServer.Protocol;
        yield* RpcServer.make(TerminalRpcGroup, config).pipe(
          Effect.provide(TerminalTransportLive),
          Effect.provideService(RpcServer.Protocol, protocol),
          Effect.interruptible,
          Effect.asVoid,
        );
      }),
    ),
};
