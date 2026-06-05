/**
 * **storeTransport** — registry-direct RPC transport for ProcessStore
 * facet queries.
 *
 * @remarks
 * Mirrors `@effect/rpc` internals (`RpcServer`, `RpcClient`) but dispatches
 * directly from `ProcessStoreRegistry` rather than through `RpcGroup`. Uses
 * `RpcServer.Protocol` directly — no forked protocol adapter.
 *
 * ## Architecture
 *
 * - **One transport, all facets** — all `Facet.layerRemote(client)` calls
 *   share the same underlying connection. Tag routing
 *   (`"RunResource/facts"`, `"QueueResource/entries"`) distinguishes
 *   facets on the wire.
 * - **Per-facet opt-in** — pass `ProcessStore.registry([RunResourceStore])`
 *   for a client that only knows about run resources.
 * - **Direct `RpcServer.Protocol`** — compose with
 *   `RpcServer.layerProtocolWebsocket({ path: "/ws/store" })` + `RpcSerialization.layerNdjson`.
 *
 * @example Server
 * ```ts
 * storeTransport.serverLayer(registry).pipe(
 *   Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/store" })),
 *   Layer.provide(RpcSerialization.layerNdjson),
 * )
 * ```
 *
 * @example Client (individual facet)
 * ```ts
 * const registry = ProcessStore.registry([RunResourceStore])
 * const client   = storeTransport.makeClient(registry, transport)
 * RunResourceStore.layerRemote(client)  // Layer<RunResourceStore.Query, never, never>
 * ```
 *
 * @example Client (all facets)
 * ```ts
 * const client = storeTransport.makeClient(
 *   ProcessStore.registry([...allFacets]),
 *   transport,
 *   [authMiddleware],
 * )
 * ProcessStorage.layerRemote(client)
 * ```
 *
 * @module storeTransport
 */

import { Effect, Layer, Stream } from "effect";
import * as Schema from "effect/Schema";
import { RpcServer } from "effect/unstable/rpc";
import type { AnyFacetClass, ProcessStoreRegistry, ProcessStoreQueryClient } from "./internal/store/service";
import {
  layerStore,
  UnknownFacet,
  UnknownMethod,
  PayloadDecodeError,
  ResultEncodeError,
  StorageError,
  StoreErrorSchema,
  type StoreServerMiddleware,
  type StoreError,
} from "./internal/store/storeTransport";
import {
  makeForQueryTag,
  makeQueryTag,
  type ExitEncoded,
  type FromClientEncoded,
  type FromServerEncoded,
  type RequestEncoded,
  type AckEncoded,
  type InterruptEncoded,
  type Ping,
  type Eof,
  type ResponseChunkEncoded,
  type ResponseExitEncoded,
  type ResponseDefectEncoded,
  type Pong,
  type ClientEnd,
  type CauseEncoded,
  type ParsedTag,
  type RequestId,
} from "./StoreMessage";
import type { RuntimeStorage } from "./RuntimeStorage";

export {
  StoreErrorSchema,
  UnknownFacet,
  UnknownMethod,
  PayloadDecodeError,
  ResultEncodeError,
  StorageError,
  type StoreError,
  type StoreServerMiddleware,
};

export type {
  ExitEncoded,
  CauseEncoded,
  RequestId,
  FromClientEncoded,
  FromServerEncoded,
  RequestEncoded,
  AckEncoded,
  InterruptEncoded,
  Ping,
  Eof,
  ResponseChunkEncoded,
  ResponseExitEncoded,
  ResponseDefectEncoded,
  Pong,
  ClientEnd,
  ParsedTag,
};

// ============================================================================
// Server config
// ============================================================================

/** @public */
export interface StoreTransportServerConfig {
  readonly middlewares?: ReadonlyArray<StoreServerMiddleware> | undefined;
  readonly disableTracing?: boolean | undefined;
  readonly spanPrefix?: string | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly concurrency?: number | "unbounded" | undefined;
  readonly disableFatalDefects?: boolean | undefined;
}

// ============================================================================
// Client middleware
// ============================================================================

/** @public */
export interface StoreClientMiddleware {
  (options: {
    readonly rpc: {
      readonly tag: string;
      readonly facet: string;
      readonly method: string;
    };
    readonly request: {
      readonly tag: string;
      readonly payload: unknown;
      readonly headers: ReadonlyArray<[string, string]>;
    };
  }): Effect.Effect<{
    readonly tag: string;
    readonly payload: unknown;
    readonly headers: ReadonlyArray<[string, string]>;
  }>;
}

// ============================================================================
// Typed client surface
// ============================================================================

/**
 * Fully typed client derived from a `ProcessStoreRegistry`.
 *
 * Stream and effect methods share the same namespace — mirroring `RpcClient`:
 * `client.RunResource.facts(payload)` → `Effect`
 * `client.RunResource.liveEvents(payload)` → `Stream`
 * `client.for.RunResource(id).byRun(payload)` → `Effect`
 *
 * @public
 */
export type StoreQueryClient<
  R extends ProcessStoreRegistry<ReadonlyArray<AnyFacetClass>>,
> = {
  readonly [Facet in keyof R["typeMap"] & string]: {
    readonly [Method in keyof R["typeMap"][Facet] & string]:
      R["typeMap"][Facet][Method] extends { readonly isStream: true; readonly payload: infer P; readonly success: infer S }
        ? (payload: P) => Stream.Stream<S, StoreError>
        : R["typeMap"][Facet][Method] extends { readonly isStream: false; readonly payload: infer P; readonly success: infer S }
          ? (payload: P) => Effect.Effect<S, StoreError>
          : never;
  };
} & {
  readonly for: {
    readonly [Facet in keyof R["forTypeMap"] & string]: (
      id: string,
    ) => {
      readonly [Method in keyof R["forTypeMap"][Facet] & string]:
        R["forTypeMap"][Facet][Method] extends { readonly isStream: true; readonly payload: infer P; readonly success: infer S }
          ? (payload: P) => Stream.Stream<S, StoreError>
          : R["forTypeMap"][Facet][Method] extends { readonly isStream: false; readonly payload: infer P; readonly success: infer S }
            ? (payload: P) => Effect.Effect<S, StoreError>
            : never;
    };
  };
};

// ============================================================================
// Transport interface (what makeClient receives)
// ============================================================================

/** @public */
export interface StoreClientTransport {
  readonly send: (request: {
    readonly tag: string;
    readonly payload: unknown;
    readonly headers: ReadonlyArray<[string, string]>;
  }) => Effect.Effect<ExitEncoded, StoreError>;

  readonly sendStream: (request: {
    readonly tag: string;
    readonly payload: unknown;
    readonly headers: ReadonlyArray<[string, string]>;
  }) => Stream.Stream<unknown, StoreError>;
}

// ============================================================================
// Exit decoding (client-side)
// ============================================================================

const decodeExitFromWire = (
  exit: ExitEncoded,
  decodeSuccess: (v: unknown) => Effect.Effect<unknown, Schema.SchemaError>,
  decodeError: (e: unknown) => Effect.Effect<StoreError, Schema.SchemaError>,
): Effect.Effect<unknown, StoreError> => {
  if (exit._tag === "Success") {
    return decodeSuccess(exit.value).pipe(
      Effect.mapError(
        (e) => new ResultEncodeError({ error: e._tag ?? String(e) }),
      ),
    );
  }
  const firstCause = exit.cause[0];
  if (firstCause === undefined || firstCause._tag === "Interrupt") {
    return Effect.interrupt.pipe(Effect.asVoid);
  }
  if (firstCause._tag === "Die") {
    return Effect.die(firstCause.defect);
  }
  return decodeError(firstCause.error).pipe(
    Effect.mapError(
      (e) => new PayloadDecodeError({ error: e._tag ?? String(e) }),
    ),
    Effect.flatMap(Effect.fail),
  );
};

// ============================================================================
// makeClient
// ============================================================================

/**
 * Build a typed `StoreQueryClient` from a registry and a transport.
 *
 * @public
 */
export const makeClient = <
  const Facets extends ReadonlyArray<AnyFacetClass>,
>(
  registry: ProcessStoreRegistry<Facets>,
  transport: StoreClientTransport,
  clientMiddlewares: ReadonlyArray<StoreClientMiddleware> = [],
): StoreQueryClient<ProcessStoreRegistry<Facets>> => {
  const applyMiddleware = (
    tag: string,
    facet: string,
    method: string,
    payload: unknown,
    headers: ReadonlyArray<[string, string]>,
  ): Effect.Effect<{
    tag: string;
    payload: unknown;
    headers: ReadonlyArray<[string, string]>;
  }> => {
    if (clientMiddlewares.length === 0) {
      return Effect.succeed({ tag, payload, headers });
    }
    return Effect.gen(function* () {
      let current: { tag: string; payload: unknown; headers: ReadonlyArray<[string, string]> } =
        { tag, payload, headers };
      for (const mw of clientMiddlewares) {
        current = yield* mw({ rpc: { tag, facet, method }, request: current });
      }
      return current;
    });
  };

  const makeEffectMethod = (
    facet: string,
    method: string,
    rawTag: string,
    encodePayload: (raw: unknown) => Effect.Effect<unknown, StoreError>,
    decodeSuccess: (v: unknown) => Effect.Effect<unknown, Schema.SchemaError>,
  ): (payload: unknown) => Effect.Effect<unknown, StoreError> =>
    (rawPayload) =>
      encodePayload(rawPayload).pipe(
        Effect.flatMap((encoded) =>
          applyMiddleware(rawTag, facet, method, encoded, []).pipe(
            Effect.flatMap((req) => transport.send(req)),
            Effect.flatMap((exit) => {
              const decodeError = (e: unknown): Effect.Effect<StoreError, Schema.SchemaError> =>
                Schema.decodeUnknownEffect(StoreErrorSchema)(e);
              return decodeExitFromWire(exit, decodeSuccess, decodeError);
            }),
          ),
        ),
      );

  const makeStreamMethod = (
    facet: string,
    method: string,
    rawTag: string,
    buildPayload: (raw: unknown) => Effect.Effect<unknown, StoreError>,
    decodeItem: (v: unknown) => Effect.Effect<unknown, Schema.SchemaError>,
  ): (payload: unknown) => Stream.Stream<unknown, StoreError> =>
    (rawPayload) =>
      Stream.unwrap(
        buildPayload(rawPayload).pipe(
          Effect.flatMap((encoded) =>
            applyMiddleware(rawTag, facet, method, encoded, []).pipe(
              Effect.map((req) =>
                transport.sendStream(req).pipe(
                  Stream.mapEffect((item) =>
                    decodeItem(item).pipe(
                      Effect.mapError((e) => new ResultEncodeError({ error: e._tag ?? String(e) })),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  const makeEncodePayload = (
    entry: { payload: Schema.Codec<any> } | undefined,
  ): (raw: unknown) => Effect.Effect<unknown, StoreError> =>
    entry !== undefined
      ? (raw) =>
          Schema.encodeUnknownEffect(entry.payload)(raw).pipe(
            Effect.mapError((e) => new PayloadDecodeError({ error: e._tag ?? String(e) })),
          )
      : Effect.succeed;

  const makeDecodeSuccess = (
    entry: { success: Schema.Codec<any> } | undefined,
  ): (v: unknown) => Effect.Effect<unknown, Schema.SchemaError> =>
    entry !== undefined
      ? (v) => Schema.decodeUnknownEffect(entry.success)(v)
      : Effect.succeed;

  const facetMethods: Record<string, Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError> | Stream.Stream<unknown, StoreError>>> = {};

  for (const [facet, methods] of Object.entries(registry.lookup)) {
    facetMethods[facet] ??= {};
    for (const [method, entry] of Object.entries(methods)) {
      facetMethods[facet]![method] = makeEffectMethod(
        facet, method, makeQueryTag(facet, method),
        makeEncodePayload(entry), makeDecodeSuccess(entry),
      );
    }
  }
  for (const [facet, methods] of Object.entries(registry.streamLookup)) {
    facetMethods[facet] ??= {};
    for (const [method, entry] of Object.entries(methods)) {
      facetMethods[facet]![method] = makeStreamMethod(
        facet, method, makeQueryTag(facet, method),
        makeEncodePayload(entry), makeDecodeSuccess(entry),
      );
    }
  }

  const forMethods: Record<string, (id: string) => Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError> | Stream.Stream<unknown, StoreError>>> = {};

  for (const [facet, methods] of Object.entries(registry.forLookup)) {
    forMethods[facet] ??= (id: string) => {
      const bound: Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError>> = {};
      for (const [method, entry] of Object.entries(methods)) {
        bound[method] = makeEffectMethod(
          facet, method, makeForQueryTag(facet, method),
          (raw) => makeEncodePayload(entry)(raw).pipe(
            Effect.map((encodedPayload) => ({ id, payload: encodedPayload })),
          ),
          makeDecodeSuccess(entry),
        );
      }
      return bound;
    };
  }
  for (const [facet, methods] of Object.entries(registry.forStreamLookup)) {
    const effectFactory = forMethods[facet];
    forMethods[facet] = (id: string) => {
      const effectBound = effectFactory !== undefined ? effectFactory(id) : {};
      const streamBound: Record<string, (payload: unknown) => Stream.Stream<unknown, StoreError>> = {};
      for (const [method, entry] of Object.entries(methods)) {
        streamBound[method] = makeStreamMethod(
          facet, method, makeForQueryTag(facet, method),
          (raw) => makeEncodePayload(entry)(raw).pipe(
            Effect.map((encodedPayload) => ({ id, payload: encodedPayload })),
          ),
          makeDecodeSuccess(entry),
        );
      }
      return { ...effectBound, ...streamBound };
    };
  }

  return { ...facetMethods, for: forMethods } as unknown as StoreQueryClient<ProcessStoreRegistry<Facets>>;
};

// ============================================================================
// toProcessStoreQueryClient — adapter for layerRemote in builder
// ============================================================================

/**
 * Adapt a `StoreQueryClient` to the `ProcessStoreQueryClient` interface
 * used by `Facet.layerRemote`. Pass the result to any facet's `layerRemote`
 * to route queries over the transport.
 *
 * @public
 */
const isStreamValue = (u: unknown): u is Stream.Stream<unknown, unknown> =>
  typeof u === "object" && u !== null && Stream.TypeId in u;

const isEffectValue = (u: unknown): u is Effect.Effect<unknown, unknown> =>
  typeof u === "object" && u !== null && Effect.TypeId in u;

export const toProcessStoreQueryClient = (
  client: unknown,
): ProcessStoreQueryClient => {
  const c = client as StoreQueryClient<any>;
  return {
    query: (facet, method, payload) => {
      const result = c[facet]?.[method]?.(payload);
      if (result !== undefined && isEffectValue(result)) return result;
      return Effect.fail(new UnknownMethod({ facet, method }));
    },
    queryFor: (facet, id, method, payload) => {
      const result = c.for?.[facet]?.(id)?.[method]?.(payload);
      if (result !== undefined && isEffectValue(result)) return result;
      return Effect.fail(new UnknownMethod({ facet, method }));
    },
    queryStream: (facet, method, payload) => {
      const result = c[facet]?.[method]?.(payload);
      if (result !== undefined && isStreamValue(result)) return result;
      return Stream.fail(new UnknownMethod({ facet, method }));
    },
    queryForStream: (facet, id, method, payload) => {
      const result = c.for?.[facet]?.(id)?.[method]?.(payload);
      if (result !== undefined && isStreamValue(result)) return result;
      return Stream.fail(new UnknownMethod({ facet, method }));
    },
  };
};

// ============================================================================
// Public namespace
// ============================================================================

/** @public */
export interface StoreTransportApi {
  readonly serverLayer: <const Facets extends ReadonlyArray<AnyFacetClass>>(
    registry: ProcessStoreRegistry<Facets>,
    config?: StoreTransportServerConfig,
  ) => Layer.Layer<never, never, RpcServer.Protocol | RuntimeStorage>;

  readonly makeClient: typeof makeClient;
  readonly toProcessStoreQueryClient: typeof toProcessStoreQueryClient;

  readonly errors: {
    readonly Schema: typeof StoreErrorSchema;
    readonly UnknownFacet: typeof UnknownFacet;
    readonly UnknownMethod: typeof UnknownMethod;
    readonly PayloadDecodeError: typeof PayloadDecodeError;
    readonly ResultEncodeError: typeof ResultEncodeError;
    readonly StorageError: typeof StorageError;
  };
}

/** @public */
export const storeTransport: StoreTransportApi = {
  serverLayer: layerStore,
  makeClient,
  toProcessStoreQueryClient,
  errors: {
    Schema: StoreErrorSchema,
    UnknownFacet,
    UnknownMethod,
    PayloadDecodeError,
    ResultEncodeError,
    StorageError,
  },
};
