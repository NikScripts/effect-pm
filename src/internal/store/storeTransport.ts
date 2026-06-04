/**
 * Registry-direct store transport server loop.
 *
 * @remarks
 * Mirrors `@effect/rpc` `RpcServer.makeNoSerialization` in structure.
 * Deviates only where `RpcGroup` context lookup is replaced by
 * `ProcessStoreRegistry` direct lookup, and where a shared
 * `ProcessStoreSpine` replaces per-handler `entry.context`.
 *
 * @module internal/store/storeTransport
 * @internal
 */

import {
  Cause,
  Data,
  Effect,
  Fiber,
  FiberSet,
  Layer,
  Latch,
  Queue,
  Scope,
  Semaphore,
  Stream,
  Tracer,
} from "effect";
import * as Schema from "effect/Schema";
import { RpcServer } from "effect/unstable/rpc";
import { RuntimeStorage } from "../../RuntimeStorage";
import type { AnyFacetClass, ProcessStoreRegistry } from "./service";
import { makeProcessStoreSpine } from "./spine";
import type {
  AckEncoded,
  ExitEncoded,
  FromClientEncoded,
  FromServerEncoded,
  InterruptEncoded,
  RequestEncoded,
  ResponseChunkEncoded,
  ResponseExitEncoded,
} from "../../StoreMessage";
import {
  constPong,
  makeResponseDefect,
  parseTag,
  RequestId,
} from "../../StoreMessage";

// ============================================================================
// Error taxonomy
// ============================================================================

/** @public */
export class UnknownFacet extends Data.TaggedError("UnknownFacet")<{
  readonly facet: string;
}> {}

/** @public */
export class UnknownMethod extends Data.TaggedError("UnknownMethod")<{
  readonly facet: string;
  readonly method: string;
}> {}

/** @public */
export class PayloadDecodeError extends Data.TaggedError("PayloadDecodeError")<{
  readonly error: string;
}> {}

/** @public */
export class ResultEncodeError extends Data.TaggedError("ResultEncodeError")<{
  readonly error: string;
}> {}

/** @public */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly cause: unknown;
}> {}

/** @public */
export const StoreErrorSchema = Schema.Union([
  Schema.instanceOf(UnknownFacet),
  Schema.instanceOf(UnknownMethod),
  Schema.instanceOf(PayloadDecodeError),
  Schema.instanceOf(ResultEncodeError),
  Schema.instanceOf(StorageError),
]);

/** @public */
export type StoreError =
  | UnknownFacet
  | UnknownMethod
  | PayloadDecodeError
  | ResultEncodeError
  | StorageError;

// ============================================================================
// Middleware
// ============================================================================

/** @public */
export interface StoreServerMiddleware {
  (options: {
    readonly clientId: number;
    readonly tag: string;
    readonly facet: string;
    readonly method: string;
    readonly headers: ReadonlyArray<[string, string]>;
  }): Effect.Effect<void, StoreError>;
}

// ============================================================================
// Schema cache
// ============================================================================

type SchemaFn = (u: unknown) => Effect.Effect<unknown, Schema.SchemaError>;

type EntrySchemas = {
  readonly decode: SchemaFn;
  readonly encodeSuccess: SchemaFn;
  readonly encodeError: SchemaFn;
};

// ============================================================================
// Exit encoding
// ============================================================================

const encodeExitSuccess = (value: unknown): ExitEncoded =>
  ({ _tag: "Success", value });

const encodeExitFail = (error: unknown): ExitEncoded =>
  ({ _tag: "Failure", cause: [{ _tag: "Fail", error }] });

const encodeExitDie = (defect: unknown): ExitEncoded =>
  ({ _tag: "Failure", cause: [{ _tag: "Die", defect }] });

const encodeExitInterrupt = (): ExitEncoded =>
  ({ _tag: "Failure", cause: [{ _tag: "Interrupt", fiberId: undefined }] });

const encodeDefectSync = Schema.encodeSync(Schema.Defect());

const encodeCause = (
  cause: Cause.Cause<StoreError>,
  schemas: EntrySchemas,
): Effect.Effect<ExitEncoded> => {
  if (Cause.hasFails(cause)) {
    const failReason = cause.reasons.find(Cause.isFailReason);
    if (failReason !== undefined) {
      return failReason.error.pipe(
        schemas.encodeError,
        Effect.matchEffect({
          onSuccess: (encoded) => Effect.succeed(encodeExitFail(encoded)),
          onFailure: () => failReason.error.pipe(encodeDefectSync, encodeExitDie, Effect.succeed),
        }),
      );
    }
  }
  if (Cause.hasInterrupts(cause)) {
    return Effect.succeed(encodeExitInterrupt());
  }
  return Effect.succeed(
    encodeExitDie(encodeDefectSync(Cause.squash(cause))),
  );
};

// ============================================================================
// Server handle type
// ============================================================================

/** @internal */
export interface StoreServer {
  readonly write: (
    clientId: number,
    message: FromClientEncoded,
  ) => Effect.Effect<void>;
  readonly disconnect: (clientId: number) => Effect.Effect<void>;
}

// ============================================================================
// makeNoStore
// ============================================================================

/** @internal */
export const makeNoStore = <
  const Facets extends ReadonlyArray<AnyFacetClass>,
>(
  registry: ProcessStoreRegistry<Facets>,
  options: {
    readonly onFromServer: (
      clientId: number,
      response: FromServerEncoded,
    ) => Effect.Effect<void>;
    readonly middlewares?: ReadonlyArray<StoreServerMiddleware> | undefined;
    readonly disableTracing?: boolean | undefined;
    readonly disableSpanPropagation?: boolean | undefined;
    readonly spanPrefix?: string | undefined;
    readonly spanAttributes?: Record<string, unknown> | undefined;
    readonly concurrency?: number | "unbounded" | undefined;
    readonly disableFatalDefects?: boolean | undefined;
    readonly disableClientAcks?: boolean | undefined;
  },
): Effect.Effect<StoreServer, never, RuntimeStorage | Scope.Scope> =>
  Effect.gen(function* () {
    const enableTracing = options.disableTracing !== true;
    const supportsAck = options.disableClientAcks !== true;
    const spanPrefix = options.spanPrefix ?? "StoreTransport";
    const concurrency = options.concurrency ?? "unbounded";
    const disableFatalDefects = options.disableFatalDefects ?? false;
    const middlewares = options.middlewares ?? [];

    const storage = yield* RuntimeStorage;
    const spine = makeProcessStoreSpine(storage, "store-transport");

    const scope = yield* Scope.Scope;
    const fiberSet = yield* FiberSet.make<void, unknown>();
    const runFork = yield* FiberSet.runtime(fiberSet)<never>();

    const semaphore =
      concurrency === "unbounded"
        ? undefined
        : Semaphore.makeUnsafe(concurrency);

    type Client = {
      readonly id: number;
      readonly latches: Map<RequestId, Latch.Latch>;
      readonly fibers: Map<RequestId, Fiber.Fiber<void, unknown>>;
      ended: boolean;
    };

    const clients = new Map<number, Client>();
    let isShutdown = false;
    const shutdownLatch = Latch.makeUnsafe(false);

    yield* Scope.addFinalizer(
      scope,
      Effect.suspend(() => {
        isShutdown = true;
        for (const client of clients.values()) {
          client.ended = true;
          for (const fiber of client.fibers.values()) {
            runFork(Fiber.interrupt(fiber));
          }
          if (client.fibers.size === 0) {
            runFork(endClient(client));
          }
        }
        return clients.size === 0 ? Effect.void : shutdownLatch.await;
      }),
    );

    const disconnect = (clientId: number) =>
      Effect.suspend(() => {
        const client = clients.get(clientId);
        if (client === undefined) return Effect.void;
        for (const fiber of client.fibers.values()) {
          runFork(Fiber.interrupt(fiber));
        }
        clients.delete(clientId);
        return Effect.void;
      });

    const schemasCache = new Map<string, EntrySchemas>();

    const getSchemas = (
      tag: string,
      entry: { payload: Schema.Codec<any>; success: Schema.Codec<any> },
    ): EntrySchemas => {
      const cached = schemasCache.get(tag);
      if (cached !== undefined) return cached;
      const schemas: EntrySchemas = {
        decode: Schema.decodeUnknownEffect(entry.payload),
        encodeSuccess: Schema.encodeUnknownEffect(entry.success),
        encodeError: Schema.encodeUnknownEffect(StoreErrorSchema),
      };
      schemasCache.set(tag, schemas);
      return schemas;
    };

    const endClient = (client: Client): Effect.Effect<void> => {
      clients.delete(client.id);
      const write = options.onFromServer(client.id, { _tag: "ClientEnd", clientId: client.id });
      return isShutdown && clients.size === 0
        ? Effect.andThen(write, shutdownLatch.open)
        : write;
    };

    const sendDefect = (client: Client, defect: unknown): Effect.Effect<void> =>
      Effect.suspend(() => {
        const write = options.onFromServer(client.id, makeResponseDefect(defect));
        return client.ended && client.fibers.size === 0
          ? Effect.andThen(write, endClient(client))
          : write;
      });

    const sendExit = (
      client: Client,
      requestId: RequestId,
      exit: ExitEncoded,
    ): Effect.Effect<void> =>
      options.onFromServer(client.id, {
        _tag: "Exit",
        requestId: String(requestId),
        exit,
      } satisfies ResponseExitEncoded);

    const streamEffect = (
      client: Client,
      requestId: RequestId,
      stream: Stream.Stream<unknown, StoreError>,
    ): Effect.Effect<void, StoreError> => {
      let latch: Latch.Latch | undefined;
      if (supportsAck) {
        latch = Latch.makeUnsafe(true);
        client.latches.set(requestId, latch);
      }
      const capturedLatch = latch;
      return Stream.runForEach(stream, (item) => {
        const write = options.onFromServer(client.id, {
          _tag: "Chunk",
          requestId: String(requestId),
          values: [item],
        } satisfies ResponseChunkEncoded);
        if (capturedLatch === undefined) return write;
        capturedLatch.closeUnsafe();
        return Effect.andThen(write, capturedLatch.await);
      });
    };

    const applyMiddleware = (
      clientId: number,
      tag: string,
      facet: string,
      method: string,
      headers: ReadonlyArray<[string, string]>,
    ): Effect.Effect<void, StoreError> => {
      if (middlewares.length === 0) return Effect.void;
      return Effect.forEach(
        middlewares,
        (mw) => mw({ clientId, tag, facet, method, headers }),
        { discard: true },
      );
    };

    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null;

    const handleRequest = (
      client: Client,
      request: RequestEncoded,
    ): Effect.Effect<void> => {
      const requestId = RequestId(request.id);
      const parsed = parseTag(request.tag);

      const lookupEntry =
        parsed._tag === "query"
          ? registry.lookup[parsed.facet]?.[parsed.method]
          : undefined;
      const forLookupEntry =
        parsed._tag === "forQuery"
          ? registry.forLookup[parsed.facet]?.[parsed.method]
          : undefined;
      const streamLookupEntry =
        parsed._tag === "query"
          ? registry.streamLookup[parsed.facet]?.[parsed.method]
          : undefined;
      const forStreamLookupEntry =
        parsed._tag === "forQuery"
          ? registry.forStreamLookup[parsed.facet]?.[parsed.method]
          : undefined;
      const isStream = streamLookupEntry !== undefined || forStreamLookupEntry !== undefined;
      const entry = lookupEntry ?? forLookupEntry ?? streamLookupEntry ?? forStreamLookupEntry;

      if (entry === undefined) {
        return sendExit(
          client,
          requestId,
          encodeExitFail(
            parsed.facet in registry.lookup
              ? new UnknownMethod({ facet: parsed.facet, method: parsed.method })
              : new UnknownFacet({ facet: parsed.facet }),
          ),
        );
      }

      const schemas = getSchemas(request.tag, entry);
      const rawPayload =
        lookupEntry !== undefined
          ? request.payload
          : isRecord(request.payload)
            ? request.payload["payload"]
            : undefined;
      const forId =
        lookupEntry !== undefined
          ? undefined
          : isRecord(request.payload)
            ? String(request.payload["id"] ?? "")
            : "";

      const resolveEffect: Effect.Effect<void, unknown> = Effect.matchEffect(
        schemas.decode(rawPayload),
        {
          onFailure: (e) =>
            sendExit(
              client,
              requestId,
              encodeExitFail(new PayloadDecodeError({ error: String(e) })),
            ),
          onSuccess: (decoded) =>
            applyMiddleware(
              client.id,
              request.tag,
              parsed.facet,
              parsed.method,
              request.headers,
            ).pipe(
              Effect.flatMap(() => {
                // Stream methods dispatch to streamEffect; effect methods go through the
                // normal encode-and-send path. Both resolve() calls are typed correctly
                // (Stream vs Effect) so no cast is needed.
                if (isStream) {
                  // Map RuntimeStorageOperationalError → StorageError so the error
                  // union stays StoreError throughout and matchCauseEffect type-checks.
                  const resolvedStream =
                    (streamLookupEntry !== undefined
                      ? streamLookupEntry.resolve(spine)(decoded)
                      : forStreamLookupEntry !== undefined && forId !== undefined
                        ? forStreamLookupEntry.resolve(forId, spine)(decoded)
                        : Stream.die("unreachable: stream entry existence checked above")
                    ).pipe(
                      Stream.mapError((e) => new StorageError({ cause: e })),
                    );

                  return streamEffect(client, requestId, resolvedStream).pipe(
                    Effect.andThen(sendExit(client, requestId, encodeExitSuccess(undefined))),
                  );
                }

                // Map RuntimeStorageOperationalError → StorageError so the error union
                // is StoreError throughout and matchCauseEffect can type-check without a cast.
                const resolvedResult: Effect.Effect<unknown, StorageError> =
                  (lookupEntry !== undefined
                    ? lookupEntry.resolve(spine)(decoded)
                    : forLookupEntry !== undefined && forId !== undefined
                      ? forLookupEntry.resolve(forId, spine)(decoded)
                      : Effect.die("unreachable: entry existence checked above")
                  ).pipe(
                    Effect.mapError((e) => new StorageError({ cause: e })),
                  );

                return resolvedResult.pipe(
                  Effect.flatMap((value) =>
                    schemas.encodeSuccess(value).pipe(
                      Effect.matchEffect({
                        onSuccess: (encoded) =>
                          sendExit(client, requestId, encodeExitSuccess(encoded)),
                        onFailure: (e) =>
                          sendExit(
                            client,
                            requestId,
                            encodeExitFail(
                              new ResultEncodeError({ error: String(e) }),
                            ),
                          ),
                      }),
                    ),
                  ),
                );
              }),
              Effect.matchCauseEffect({
                onSuccess: () => Effect.void,
                onFailure: (cause) =>
                  encodeCause(cause, schemas).pipe(
                    Effect.flatMap((exit) => {
                      if (
                        !disableFatalDefects &&
                        Cause.hasDies(cause) &&
                        !Cause.hasFails(cause)
                      ) {
                        return sendDefect(client, Cause.squash(cause));
                      }
                      return sendExit(client, requestId, exit);
                    }),
                  ),
              }),
            ),
        },
      );

      let effect: Effect.Effect<void, unknown> = resolveEffect;

      if (enableTracing) {
        const spanParent =
          options.disableSpanPropagation !== true && request.spanId !== undefined
            ? Tracer.externalSpan({
                traceId: request.traceId ?? "",
                spanId: request.spanId,
                sampled: request.sampled ?? true,
              })
            : undefined;
        effect = Effect.withSpan(effect, `${spanPrefix}.${request.tag}`, {
          captureStackTrace: false,
          attributes: {
            requestId: request.id,
            facet: parsed.facet,
            method: parsed.method,
            ...options.spanAttributes,
          },
          parent: spanParent,
        });
      }

      if (semaphore !== undefined) {
        effect = semaphore.withPermits(1)(effect);
      }

      const fiber = runFork(effect);
      client.fibers.set(requestId, fiber);
      fiber.addObserver(() => {
        client.fibers.delete(requestId);
        client.latches.delete(requestId);
        if (client.ended && client.fibers.size === 0) {
          runFork(endClient(client));
        }
      });
      return Effect.void;
    };

    const write = (
      clientId: number,
      message: FromClientEncoded,
    ): Effect.Effect<void> =>
      Effect.catchCause(
        Effect.suspend(() => {
          if (isShutdown) return Effect.interrupt;
          let client = clients.get(clientId);
          if (client === undefined) {
            client = { id: clientId, latches: new Map(), fibers: new Map(), ended: false };
            clients.set(clientId, client);
          } else if (client.ended) {
            return Effect.interrupt;
          }
          switch (message._tag) {
            case "Request":
              return handleRequest(client, message as RequestEncoded);
            case "Ack": {
              const latch = client.latches.get(RequestId((message as AckEncoded).requestId));
              return latch !== undefined ? latch.open : Effect.void;
            }
            case "Interrupt": {
              const fiber = client.fibers.get(RequestId((message as InterruptEncoded).requestId));
              return fiber !== undefined ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;
            }
            case "Eof": {
              client.ended = true;
              return client.fibers.size > 0 ? Effect.void : endClient(client);
            }
            case "Ping":
              return options.onFromServer(clientId, constPong);
            default:
              return sendDefect(client, `Unknown message tag: ${(message as { _tag: string })._tag}`);
          }
        }),
        (cause) => {
          const client = clients.get(clientId);
          return client !== undefined ? sendDefect(client, Cause.squash(cause)) : Effect.void;
        },
      );

    return { write, disconnect };
  });

// ============================================================================
// Full server with Protocol integration
// ============================================================================

/** @internal */
export const makeStore = <
  const Facets extends ReadonlyArray<AnyFacetClass>,
>(
  registry: ProcessStoreRegistry<Facets>,
  options?: {
    readonly middlewares?: ReadonlyArray<StoreServerMiddleware> | undefined;
    readonly disableTracing?: boolean | undefined;
    readonly spanPrefix?: string | undefined;
    readonly spanAttributes?: Record<string, unknown> | undefined;
    readonly concurrency?: number | "unbounded" | undefined;
    readonly disableFatalDefects?: boolean | undefined;
  },
) =>
  Effect.gen(function* () {
    const protocol = yield* RpcServer.Protocol;
    const { run, disconnects, send, end, supportsAck, supportsSpanPropagation } = protocol;

    const server = yield* makeNoStore(registry, {
      ...options,
      disableClientAcks: !supportsAck,
      disableSpanPropagation: !supportsSpanPropagation,
      onFromServer: (clientId, response) =>
        response._tag === "ClientEnd" ? end(response.clientId) : send(clientId, response as any),
    });

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(disconnects), (clientId) => server.disconnect(clientId)),
      ),
    );

    return yield* run((clientId: number, message: any) => server.write(clientId, message)).pipe(
      Effect.interruptible,
      Effect.asVoid,
    );
  });

/** @internal */
export const layerStore = <
  const Facets extends ReadonlyArray<AnyFacetClass>,
>(
  registry: ProcessStoreRegistry<Facets>,
  options?: Parameters<typeof makeStore>[1],
): Layer.Layer<
  never,
  never,
  RpcServer.Protocol | RuntimeStorage
> =>
  Layer.effectDiscard(
    Effect.forkScoped(makeStore(registry, options)),
  );
