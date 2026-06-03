/**
 * **StoreTransportRpc** — registry-direct RPC transport for ProcessStore
 * facet queries.
 *
 * @remarks
 * Mirrors `@effect/rpc` internals (`RpcServer`, `RpcClient`) but dispatches
 * directly from `ProcessStoreRegistry` rather than through `RpcGroup`. All
 * ten wire message types are identical to Effect RPC; the same
 * `layerProtocol*` implementations work via `layerProtocolFromRpc`.
 *
 * ## Architecture
 *
 * - **One transport, all facets** — all `Facet.layerRemote(client)` calls
 *   share the same underlying connection. Tag routing
 *   (`"RunResource/facts"`, `"QueueResource/entries"`) distinguishes
 *   facets on the wire.
 * - **Per-facet opt-in** — pass `ProcessStore.registry([RunResourceStore])`
 *   for a client that only knows about run resources.
 * - **Protocol-agnostic** — provide any `Layer<StoreTransportProtocol>`;
 *   use `layerProtocolFromRpc` to adapt existing Effect RPC protocol
 *   implementations (WebSocket, HTTP, SocketServer).
 *
 * @example Server
 * ```ts
 * StoreTransportRpc.serverLayer(registry).pipe(
 *   Layer.provide(StoreTransportRpc.layerProtocolFromRpc),
 *   Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/store" })),
 *   Layer.provide(RpcServer.layerNdjson),
 * )
 * ```
 *
 * @example Client (individual facet)
 * ```ts
 * const registry = ProcessStore.registry([RunResourceStore])
 * const client   = StoreTransportRpc.makeClient(registry, transport)
 * RunResourceStore.layerRemote(client)  // Layer<RunResourceStore.Query, never, never>
 * ```
 *
 * @example Client (all facets)
 * ```ts
 * const client = StoreTransportRpc.makeClient(
 *   ProcessStore.registry([...allFacets]),
 *   transport,
 *   [authMiddleware],
 * )
 * ProcessStorage.layerRemote(client)
 * ```
 *
 * @module StoreTransportRpc
 */

import { Effect, Layer, Stream } from "effect";
import * as Schema from "effect/Schema";
import { RpcServer } from "effect/unstable/rpc";
import type { AnyFacetClass, ProcessStoreRegistry, ProcessStoreQueryClient } from "./internal/store/service";
import {
  layerStore,
  StoreTransportProtocol,
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
} from "./StoreMessage";
import type { RuntimeStorage } from "./RuntimeStorage";

export {
  StoreTransportProtocol,
  StoreErrorSchema,
  UnknownFacet,
  UnknownMethod,
  PayloadDecodeError,
  ResultEncodeError,
  StorageError,
  type StoreError,
  type StoreServerMiddleware,
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
 * Each facet's methods are accessible as named nested properties:
 * `client.RunResource.facts(payload)` / `client.for.RunResource(id).byRun(payload)`
 *
 * @public
 */
export type StoreQueryClient<
  R extends ProcessStoreRegistry<ReadonlyArray<AnyFacetClass>>,
> = {
  readonly [Facet in keyof R["typeMap"] & string]: {
    readonly [Method in keyof R["typeMap"][Facet] & string]: (
      payload: R["typeMap"][Facet][Method]["payload"],
    ) => Effect.Effect<R["typeMap"][Facet][Method]["success"], StoreError>;
  };
} & {
  readonly for: {
    readonly [Facet in keyof R["forTypeMap"] & string]: (
      id: string,
    ) => {
      readonly [Method in keyof R["forTypeMap"][Facet] & string]: (
        payload: R["forTypeMap"][Facet][Method]["payload"],
      ) => Effect.Effect<R["forTypeMap"][Facet][Method]["success"], StoreError>;
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

  const callQuery = (
    facet: string,
    method: string,
    rawPayload: unknown,
  ): Effect.Effect<unknown, StoreError> => {
    const entry = registry.lookup[facet]?.[method];
    const tag = makeQueryTag(facet, method);

    const encodePayload: Effect.Effect<unknown, StoreError> =
      entry !== undefined
        ? Schema.encodeUnknownEffect(entry.payload)(rawPayload).pipe(
            Effect.mapError(
              (e) => new PayloadDecodeError({ error: e._tag ?? String(e) }),
            ),
          )
        : Effect.succeed(rawPayload);

    return Effect.flatMap(encodePayload, (encoded) =>
      applyMiddleware(tag, facet, method, encoded, []).pipe(
        Effect.flatMap((req) => transport.send(req)),
        Effect.flatMap((exit) => {
          const decodeSuccess: (v: unknown) => Effect.Effect<unknown, Schema.SchemaError> =
            entry !== undefined
              ? (v) => Schema.decodeUnknownEffect(entry.success)(v)
              : (v) => Effect.succeed(v);
          const decodeError = (e: unknown): Effect.Effect<StoreError, Schema.SchemaError> =>
            Schema.decodeUnknownEffect(StoreErrorSchema)(e);
          return decodeExitFromWire(exit, decodeSuccess, decodeError);
        }),
      ),
    );
  };

  const callForQuery = (
    facet: string,
    id: string,
    method: string,
    rawPayload: unknown,
  ): Effect.Effect<unknown, StoreError> => {
    const entry = registry.forLookup[facet]?.[method];
    const tag = makeForQueryTag(facet, method);

    const encodePayload: Effect.Effect<unknown, StoreError> =
      entry !== undefined
        ? Schema.encodeUnknownEffect(entry.payload)(rawPayload).pipe(
            Effect.mapError(
              (e) => new PayloadDecodeError({ error: e._tag ?? String(e) }),
            ),
          )
        : Effect.succeed(rawPayload);

    return Effect.flatMap(encodePayload, (encodedPayload) =>
      applyMiddleware(tag, facet, method, { id, payload: encodedPayload }, []).pipe(
        Effect.flatMap((req) => transport.send(req)),
        Effect.flatMap((exit) => {
          const decodeSuccess: (v: unknown) => Effect.Effect<unknown, Schema.SchemaError> =
            entry !== undefined
              ? (v) => Schema.decodeUnknownEffect(entry.success)(v)
              : (v) => Effect.succeed(v);
          const decodeError = (e: unknown): Effect.Effect<StoreError, Schema.SchemaError> =>
            Schema.decodeUnknownEffect(StoreErrorSchema)(e);
          return decodeExitFromWire(exit, decodeSuccess, decodeError);
        }),
      ),
    );
  };

  const queryMethods: Record<string, Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError>>> = {};
  for (const [facet, methods] of Object.entries(registry.lookup)) {
    const facetMethods: Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError>> = {};
    for (const method of Object.keys(methods)) {
      facetMethods[method] = (payload: unknown) => callQuery(facet, method, payload);
    }
    queryMethods[facet] = facetMethods;
  }

  const forMethods: Record<string, (id: string) => Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError>>> = {};
  for (const [facet, methods] of Object.entries(registry.forLookup)) {
    forMethods[facet] = (id: string) => {
      const bound: Record<string, (payload: unknown) => Effect.Effect<unknown, StoreError>> = {};
      for (const method of Object.keys(methods)) {
        bound[method] = (payload: unknown) => callForQuery(facet, id, method, payload);
      }
      return bound;
    };
  }

  // StoreQueryClient<R> is a phantom-mapped type derived from registry.typeMap
  // (a phantom {}). TypeScript cannot derive it from Record<string,…> even though
  // the runtime keys match exactly — this structural coercion is the boundary between
  // the dynamic build and the typed surface.
  return { ...queryMethods, for: forMethods } as unknown as StoreQueryClient<ProcessStoreRegistry<Facets>>;
};

// ============================================================================
// toProcessStoreQueryClient — adapter for layerRemote in builder
// ============================================================================

/**
 * Adapt a `StoreQueryClient` to the internal `ProcessStoreQueryClient`
 * interface used by `Facet.layerRemote`.
 *
 * @internal
 */
export const toProcessStoreQueryClient = (
  client: StoreQueryClient<any>,
): ProcessStoreQueryClient => ({
  query: (facet, method, payload) =>
    client[facet]?.[method]?.(payload) ??
    Effect.fail(new UnknownMethod({ facet, method })),
  queryFor: (facet, id, method, payload) =>
    client.for?.[facet]?.(id)?.[method]?.(payload) ??
    Effect.fail(new UnknownMethod({ facet, method })),
});

// ============================================================================
// Protocol bridge
// ============================================================================

/**
 * Bridge any `RpcServer.Protocol` implementation to `StoreTransportProtocol`.
 *
 * @public
 */
export const layerProtocolFromRpc: Layer.Layer<
  StoreTransportProtocol,
  never,
  RpcServer.Protocol
> = Layer.effect(
  StoreTransportProtocol,
  Effect.map(RpcServer.Protocol, (p) =>
    StoreTransportProtocol.of({
      // FromClientEncoded is structurally identical to RpcMessage.FromClientEncoded.
      run: p.run,
      // FromServerEncoded minus ClientEnd is a structural subtype of RpcFromServerEncoded.
      // ClientEnd is handled separately via end() in makeStore and never passed to send().
      send: (clientId, response) => p.send(clientId, response),
      end: p.end,
      disconnects: p.disconnects,
      clientIds: p.clientIds,
      supportsAck: p.supportsAck,
      supportsSpanPropagation: p.supportsSpanPropagation,
    }),
  ),
);

// ============================================================================
// Public namespace
// ============================================================================

/** @public */
export interface StoreTransportRpcApi {
  readonly serverLayer: <const Facets extends ReadonlyArray<AnyFacetClass>>(
    registry: ProcessStoreRegistry<Facets>,
    config?: StoreTransportServerConfig,
  ) => Layer.Layer<never, never, StoreTransportProtocol | RuntimeStorage>;

  readonly makeClient: typeof makeClient;
  readonly toProcessStoreQueryClient: typeof toProcessStoreQueryClient;
  readonly layerProtocolFromRpc: typeof layerProtocolFromRpc;

  readonly Protocol: typeof StoreTransportProtocol;
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
export const StoreTransportRpc: StoreTransportRpcApi = {
  serverLayer: layerStore,
  makeClient,
  toProcessStoreQueryClient,
  layerProtocolFromRpc,
  Protocol: StoreTransportProtocol,
  errors: {
    Schema: StoreErrorSchema,
    UnknownFacet,
    UnknownMethod,
    PayloadDecodeError,
    ResultEncodeError,
    StorageError,
  },
};
