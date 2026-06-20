/**
 * **Terminal** — transport-neutral remote terminal session contracts.
 *
 * @module Terminal
 */

import { Context, Data, Effect, Schema, Stream } from "effect";

/** @public */
export const TerminalAuditMetadataSchema = Schema.Struct({
  actor: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  requestId: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["dashboard", "cli", "api"])),
});

/** @public */
export type TerminalAuditMetadata = typeof TerminalAuditMetadataSchema.Type;

/** @public */
export const OpenTerminalSessionSchema = Schema.Struct({
  groupId: Schema.String,
  target: Schema.String,
  command: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  cols: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Number),
  metadata: Schema.optional(TerminalAuditMetadataSchema),
});

/** @public */
export type OpenTerminalSession = typeof OpenTerminalSessionSchema.Type;

/** @public */
export const TerminalSessionIdSchema = Schema.Struct({
  sessionId: Schema.String,
});

/** @public */
export type TerminalSessionId = typeof TerminalSessionIdSchema.Type;

/** @public */
export const TerminalEventSchema = Schema.Union([
  Schema.TaggedStruct("Opened", {
    sessionId: Schema.String,
    groupId: Schema.String,
  }),
  Schema.TaggedStruct("Output", {
    sessionId: Schema.String,
    chunk: Schema.Uint8Array,
  }),
  Schema.TaggedStruct("Exit", {
    sessionId: Schema.String,
    code: Schema.Number,
  }),
  Schema.TaggedStruct("Closed", {
    sessionId: Schema.String,
    reason: Schema.String,
  }),
]);

/** @public */
export type TerminalEvent = typeof TerminalEventSchema.Type;

/** @public */
export const TerminalSessionErrorSchema = Schema.TaggedStruct(
  "TerminalSessionError",
  {
    reason: Schema.String,
  },
);

/** @public */
export class TerminalSessionError extends Data.TaggedError(
  "TerminalSessionError",
)<{
  readonly reason: string;
}> {}

/** @public */
export interface TerminalSessionPort {
  readonly open: (input: OpenTerminalSession) => Promise<TerminalSessionId>;
  readonly input: (sessionId: string, chunk: Uint8Array) => Promise<void>;
  readonly resize: (
    sessionId: string,
    size: { readonly cols: number; readonly rows: number },
  ) => Promise<void>;
  readonly close: (sessionId: string) => Promise<void>;
  readonly events: (sessionId: string) => AsyncIterable<TerminalEvent>;
}

/** @public */
export interface TerminalSessionHandle {
  readonly sessionId: string;
  readonly input: (chunk: Uint8Array) => Effect.Effect<void, TerminalSessionError>;
  readonly resize: (
    size: { readonly cols: number; readonly rows: number },
  ) => Effect.Effect<void, TerminalSessionError>;
  readonly events: Stream.Stream<TerminalEvent, TerminalSessionError>;
  readonly close: Effect.Effect<void, TerminalSessionError>;
}

/** @public */
export interface TerminalSessionServiceShape {
  readonly open: (
    input: OpenTerminalSession,
  ) => Effect.Effect<TerminalSessionHandle, TerminalSessionError>;
}

/** @public */
export class TerminalSessionService extends Context.Service<
  TerminalSessionService,
  TerminalSessionServiceShape
>()("@nikscripts/effect-pm/Terminal/TerminalSessionService") {}

export declare namespace TerminalSessionService {
  export type Type = TerminalSessionServiceShape;
}

interface TerminalApi {
  readonly Schema: {
    readonly AuditMetadata: typeof TerminalAuditMetadataSchema;
    readonly OpenSession: typeof OpenTerminalSessionSchema;
    readonly SessionId: typeof TerminalSessionIdSchema;
    readonly Event: typeof TerminalEventSchema;
    readonly Error: typeof TerminalSessionErrorSchema;
  };
  readonly Service: typeof TerminalSessionService;
  readonly Errors: {
    readonly TerminalSessionError: typeof TerminalSessionError;
  };
}

/** @public */
export const Terminal: TerminalApi = {
  Schema: {
    AuditMetadata: TerminalAuditMetadataSchema,
    OpenSession: OpenTerminalSessionSchema,
    SessionId: TerminalSessionIdSchema,
    Event: TerminalEventSchema,
    Error: TerminalSessionErrorSchema,
  },
  Service: TerminalSessionService,
  Errors: {
    TerminalSessionError,
  },
};
