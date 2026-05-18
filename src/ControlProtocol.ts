/**
 * Transport-neutral control protocol for typed {@link ProcessGroup} control.
 *
 * @module ControlProtocol
 */

import { Context, Data, Effect, Layer, Schema, Scope } from "effect";
import type {
  ProcessGroupEntry,
  ProcessGroupEntryRequirements,
  ProcessGroupProcessEntries,
  ProcessGroupQueueEntries,
  ProcessGroupServiceDefinition,
  TypedProcessGroup,
} from "./ProcessGroup";
import type { ProcessStore } from "./ProcessStore";

/**
 * Control API response.
 *
 * @typeParam T - Type of data returned by the control operation.
 *
 * @public
 */
export interface ControlResponse<T = unknown> {
  /** Whether the command succeeded. */
  readonly success: boolean;
  /** Response type for entity status commands. */
  readonly type?: "process" | "queue";
  /** Response data, when applicable. */
  readonly data?: T;
  /** Error message, when the command failed. */
  readonly error?: string;
}

/**
 * Runtime schema for {@link ControlResponse}.
 *
 * @public
 */
export const ControlResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  type: Schema.optional(Schema.Literals(["process", "queue"] as const)),
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});

/**
 * Transport-neutral request envelope for group controls.
 *
 * @public
 */
export type ControlProtocolRequest =
  | { readonly _tag: "GetContract" }
  | { readonly _tag: "ReadGroupStatus" }
  | { readonly _tag: "ListProcesses" }
  | { readonly _tag: "ReadProcessStatus"; readonly processId: string }
  | { readonly _tag: "StartProcess"; readonly processId: string }
  | { readonly _tag: "StopProcess"; readonly processId: string }
  | { readonly _tag: "RestartProcess"; readonly processId: string }
  | { readonly _tag: "RunProcessImmediately"; readonly processId: string }
  | { readonly _tag: "ListQueues" }
  | { readonly _tag: "ReadQueueStatus"; readonly queueId: string }
  | { readonly _tag: "StartQueue"; readonly queueId: string }
  | { readonly _tag: "PauseQueue"; readonly queueId: string }
  | { readonly _tag: "ResumeQueue"; readonly queueId: string }
  | { readonly _tag: "ClearQueue"; readonly queueId: string };

/**
 * Runtime schema for {@link ControlProtocolRequest}.
 *
 * @public
 */
export const ControlProtocolRequestSchema = Schema.Union([
  Schema.TaggedStruct("GetContract", {}),
  Schema.TaggedStruct("ReadGroupStatus", {}),
  Schema.TaggedStruct("ListProcesses", {}),
  Schema.TaggedStruct("ReadProcessStatus", {
    processId: Schema.String,
  }),
  Schema.TaggedStruct("StartProcess", {
    processId: Schema.String,
  }),
  Schema.TaggedStruct("StopProcess", {
    processId: Schema.String,
  }),
  Schema.TaggedStruct("RestartProcess", {
    processId: Schema.String,
  }),
  Schema.TaggedStruct("RunProcessImmediately", {
    processId: Schema.String,
  }),
  Schema.TaggedStruct("ListQueues", {}),
  Schema.TaggedStruct("ReadQueueStatus", {
    queueId: Schema.String,
  }),
  Schema.TaggedStruct("StartQueue", {
    queueId: Schema.String,
  }),
  Schema.TaggedStruct("PauseQueue", {
    queueId: Schema.String,
  }),
  Schema.TaggedStruct("ResumeQueue", {
    queueId: Schema.String,
  }),
  Schema.TaggedStruct("ClearQueue", {
    queueId: Schema.String,
  }),
]);

/**
 * Transport-neutral response envelope for group controls.
 *
 * @public
 */
export type ControlProtocolResponse =
  | {
      readonly _tag: "Contract";
      readonly status: number;
      readonly body: unknown;
    }
  | {
      readonly _tag: "Control";
      readonly status: number;
      readonly body: ControlResponse<unknown>;
    };

/**
 * Protocol router backed by a typed process group.
 *
 * @public
 */
export interface ControlProtocolRouter<R> {
  readonly handle: (
    request: ControlProtocolRequest,
  ) => Effect.Effect<ControlProtocolResponse, never, R>;
}

/**
 * Fully provided control router service.
 *
 * @public
 */
export interface ControlRouterShape {
  readonly handle: (
    request: ControlProtocolRequest,
  ) => Effect.Effect<ControlProtocolResponse>;
}

/**
 * Injectable router for transport-neutral control requests.
 *
 * @public
 */
export class ControlRouter extends Context.Service<
  ControlRouter,
  ControlRouterShape
>()("@nikscripts/effect-pm/ControlProtocol/ControlRouter") {}

/**
 * Checked error raised by a control transport adapter.
 *
 * @public
 */
export class ControlTransportError extends Data.TaggedError(
  "ControlTransportError",
)<{
  readonly reason: string;
  readonly status?: number;
}> {}

/**
 * Client side of a control transport.
 *
 * @public
 */
export interface ControlTransportClientShape<Requirements = never> {
  readonly request: (
    request: ControlProtocolRequest,
  ) => Effect.Effect<ControlProtocolResponse, ControlTransportError, Requirements>;
}

/**
 * Injectable transport client service for applications that prefer layer wiring.
 *
 * @public
 */
export class ControlTransportClient extends Context.Service<
  ControlTransportClient,
  ControlTransportClientShape
>()("@nikscripts/effect-pm/ControlProtocol/ControlTransportClient") {}

/**
 * Server side of a control transport.
 *
 * @public
 */
export interface ControlTransportServerShape {
  readonly serve: Effect.Effect<
    void,
    ControlTransportError,
    Scope.Scope | ControlRouter
  >;
}

/**
 * Injectable server transport for exposing a {@link ControlRouter}.
 *
 * @public
 */
export class ControlTransportServer extends Context.Service<
  ControlTransportServer,
  ControlTransportServerShape
>()("@nikscripts/effect-pm/ControlProtocol/ControlTransportServer") {}

const processStatusResponse = <T>(
  data: T,
): ControlResponse<T> & { readonly type: "process" } => ({
  success: true,
  data,
  type: "process",
});

const queueStatusResponse = <T>(
  data: T,
): ControlResponse<T> & { readonly type: "queue" } => ({
  success: true,
  data,
  type: "queue",
});

const successResponse = <T>(data?: T): ControlResponse<T> => ({
  success: true,
  ...(data === undefined ? {} : { data }),
});

export const errorResponse = (error: string): ControlResponse<never> => ({
  success: false,
  error,
});

const errorTag = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return undefined;
  }
  const tag = error._tag;
  return typeof tag === "string" ? tag : undefined;
};

export const controlErrorStatus = (error: unknown): number => {
  const tag = errorTag(error);
  if (tag === "ProcessNotFoundError") {
    return 404;
  }
  if (
    tag === "ProcessAlreadyRunningError" ||
    tag === "ProcessNotRunningError"
  ) {
    return 409;
  }
  if (tag === "UnsupportedRemoteControlError") {
    return 400;
  }
  if (tag === "ProcessGroupRemoteControlError") {
    if (typeof error === "object" && error !== null && "status" in error) {
      const status = error.status;
      return typeof status === "number" ? status : 502;
    }
    return 502;
  }
  return 500;
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = error.reason;
    if (typeof reason === "string") {
      return reason;
    }
  }
  return fallback;
};

const routeFailure = (
  error: unknown,
  fallback: string,
): ControlProtocolResponse => ({
  _tag: "Control",
  status: controlErrorStatus(error),
  body: errorResponse(errorMessage(error, fallback)),
});

const ok = <T>(body: ControlResponse<T>): ControlProtocolResponse => ({
  _tag: "Control",
  status: 200,
  body,
});

const routeValue = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  body: (value: A) => ControlResponse<unknown>,
  fallback: string,
): Effect.Effect<ControlProtocolResponse, never, R> =>
  effect.pipe(
    Effect.map((value) => ok(body(value))),
    Effect.catch((error) => Effect.succeed(routeFailure(error, fallback))),
  );

const routeVoid = <E, R>(
  effect: Effect.Effect<void, E, R>,
  fallback: string,
): Effect.Effect<ControlProtocolResponse, never, R> =>
  effect.pipe(
    Effect.as(ok(successResponse())),
    Effect.catch((error) => Effect.succeed(routeFailure(error, fallback))),
  );

const findProcessEntry = <
  const Entries extends readonly ProcessGroupEntry[],
>(
  entries: Entries,
  id: string,
): ProcessGroupProcessEntries<Entries> | undefined =>
  entries.find(
    (entry): entry is ProcessGroupProcessEntries<Entries> =>
      entry.kind === "process" && entry.id === id,
  );

const findQueueEntry = <
  const Entries extends readonly ProcessGroupEntry[],
>(
  entries: Entries,
  id: string,
): ProcessGroupQueueEntries<Entries> | undefined =>
  entries.find(
    (entry): entry is ProcessGroupQueueEntries<Entries> =>
      entry.kind === "queue" && entry.id === id,
  );

/**
 * Build a transport-neutral request router for a typed process group.
 *
 * @public
 */
export const makeControlProtocolRouter = <
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Error,
>(
  group: TypedProcessGroup<Id, Entries, Error>,
): ControlProtocolRouter<ProcessGroupEntryRequirements<Entries> | ProcessStore> => ({
  handle: (request) =>
    Effect.gen(function* () {
      switch (request._tag) {
        case "GetContract":
          return {
            _tag: "Contract",
            status: 200,
            body: group.contract,
          };

        case "ReadGroupStatus":
          return yield* routeValue(
            group.status,
            successResponse,
            "Unable to read group status",
          );

        case "ListProcesses":
          return yield* routeValue(
            group.status,
            (groupStatus) => successResponse(groupStatus.processes),
            "Unable to list processes",
          );

        case "ReadProcessStatus": {
          const entry = findProcessEntry(group.entries, request.processId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Process '${request.processId}' not found`),
            };
          }
          return yield* routeValue(
            group.process(entry).status,
            processStatusResponse,
            `Process '${request.processId}' not found`,
          );
        }

        case "StartProcess": {
          const entry = findProcessEntry(group.entries, request.processId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Process '${request.processId}' not found`),
            };
          }
          return yield* routeVoid(
            group.process(entry).start,
            `Process '${request.processId}' could not be started`,
          );
        }

        case "StopProcess": {
          const entry = findProcessEntry(group.entries, request.processId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Process '${request.processId}' not found`),
            };
          }
          return yield* routeVoid(
            group.process(entry).stop,
            `Process '${request.processId}' could not be stopped`,
          );
        }

        case "RestartProcess": {
          const entry = findProcessEntry(group.entries, request.processId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Process '${request.processId}' not found`),
            };
          }
          return yield* routeVoid(
            group.process(entry).restart,
            `Process '${request.processId}' could not be restarted`,
          );
        }

        case "RunProcessImmediately": {
          const entry = findProcessEntry(group.entries, request.processId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Process '${request.processId}' not found`),
            };
          }
          return yield* routeVoid(
            group.process(entry).runImmediately,
            `Process '${request.processId}' could not run immediately`,
          );
        }

        case "ListQueues":
          return yield* routeValue(
            group.status,
            (groupStatus) => successResponse(groupStatus.queues),
            "Unable to list queues",
          );

        case "ReadQueueStatus": {
          const entry = findQueueEntry(group.entries, request.queueId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Queue '${request.queueId}' not found`),
            };
          }
          return yield* routeValue(
            group.queue(entry).status,
            queueStatusResponse,
            `Queue '${request.queueId}' not found`,
          );
        }

        case "StartQueue": {
          const entry = findQueueEntry(group.entries, request.queueId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Queue '${request.queueId}' not found`),
            };
          }
          return yield* routeVoid(
            group.queue(entry).start,
            `Queue '${request.queueId}' could not be started`,
          );
        }

        case "PauseQueue": {
          const entry = findQueueEntry(group.entries, request.queueId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Queue '${request.queueId}' not found`),
            };
          }
          return yield* routeVoid(
            group.queue(entry).pause,
            `Queue '${request.queueId}' could not be paused`,
          );
        }

        case "ResumeQueue": {
          const entry = findQueueEntry(group.entries, request.queueId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Queue '${request.queueId}' not found`),
            };
          }
          return yield* routeVoid(
            group.queue(entry).resume,
            `Queue '${request.queueId}' could not be resumed`,
          );
        }

        case "ClearQueue": {
          const entry = findQueueEntry(group.entries, request.queueId);
          if (entry === undefined) {
            return {
              _tag: "Control",
              status: 404,
              body: errorResponse(`Queue '${request.queueId}' not found`),
            };
          }
          return yield* routeValue(
            group.queue(entry).clear,
            (cleared) => successResponse({ cleared }),
            `Queue '${request.queueId}' could not be cleared`,
          );
        }
      }
    }),
});

const makeProvidedControlRouter = <
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Error,
>(
  group: TypedProcessGroup<Id, Entries, Error>,
  context: Context.Context<ProcessGroupEntryRequirements<Entries> | ProcessStore>,
): ControlRouterShape => {
  const router = makeControlProtocolRouter(group);
  return {
    handle: (request) => router.handle(request).pipe(Effect.provide(context)),
  };
};

export namespace ControlRouter {
  /**
   * Provide a router from an already acquired typed group value.
   *
   * @public
   */
  export const layer = <
    const Id extends string,
    const Entries extends readonly ProcessGroupEntry[],
    Error,
  >(
    group: TypedProcessGroup<Id, Entries, Error>,
  ): Layer.Layer<
    ControlRouter,
    never,
    ProcessGroupEntryRequirements<Entries> | ProcessStore
  > =>
    Layer.effect(
      ControlRouter,
      Effect.map(
        Effect.context<ProcessGroupEntryRequirements<Entries> | ProcessStore>(),
        (context) => makeProvidedControlRouter(group, context),
      ),
    );

  /**
   * Provide a router by yielding a group service from the environment.
   *
   * @public
   */
  export const layerFromGroup = <
    Self,
    const Id extends string,
    const Entries extends readonly ProcessGroupEntry[],
  >(
    group: ProcessGroupServiceDefinition<Self, Id, Entries>,
  ): Layer.Layer<
    ControlRouter,
    never,
    Self | ProcessGroupEntryRequirements<Entries> | ProcessStore
  > =>
    Layer.effect(
      ControlRouter,
      Effect.gen(function* () {
        const value = yield* group;
        const context = yield* Effect.context<
          ProcessGroupEntryRequirements<Entries> | ProcessStore
        >();
        return makeProvidedControlRouter(value, context);
      }),
    );
}
