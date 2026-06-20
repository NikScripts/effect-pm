/**
 * Effect RPC group for terminal sessions.
 *
 * @module TerminalRpc
 */

import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { Schema } from "effect";
import {
  OpenTerminalSessionSchema,
  TerminalEventSchema,
  TerminalSessionErrorSchema,
  TerminalSessionIdSchema,
} from "./Terminal";

const terminalInputPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  chunk: Schema.Uint8Array,
});

const terminalResizePayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
});

const terminalSessionIdPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
});

/** @public */
export const TerminalRpcGroup = RpcGroup.make(
  Rpc.make("Terminal.Open", {
    payload: OpenTerminalSessionSchema,
    success: TerminalSessionIdSchema,
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Input", {
    payload: terminalInputPayloadSchema,
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Resize", {
    payload: terminalResizePayloadSchema,
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Close", {
    payload: terminalSessionIdPayloadSchema,
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Events", {
    payload: terminalSessionIdPayloadSchema,
    success: TerminalEventSchema,
    error: TerminalSessionErrorSchema,
    stream: true,
  }),
);

interface TerminalRpcApi {
  readonly Group: typeof TerminalRpcGroup;
  readonly Schema: {
    readonly InputPayload: typeof terminalInputPayloadSchema;
    readonly ResizePayload: typeof terminalResizePayloadSchema;
    readonly SessionIdPayload: typeof terminalSessionIdPayloadSchema;
  };
}

/** @public */
export const TerminalRpc: TerminalRpcApi = {
  Group: TerminalRpcGroup,
  Schema: {
    InputPayload: terminalInputPayloadSchema,
    ResizePayload: terminalResizePayloadSchema,
    SessionIdPayload: terminalSessionIdPayloadSchema,
  },
};
