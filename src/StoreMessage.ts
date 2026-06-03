/**
 * Wire message types for the store transport protocol.
 *
 * @remarks
 * Mirrors `@effect/rpc` `RpcMessage` exactly — same 10 message types,
 * same encoded shapes, same `RequestId` brand. Deviations:
 *
 * - No `FromClient<A>` / `FromServer<A>` typed generics (no `RpcGroup`).
 * - No `ClientProtocolError` (no client-specific error type yet).
 * - `tag` encodes both query and forQuery paths:
 *   - query:    `"${processTag}/${method}"`
 *   - forQuery: `"${processTag}/for/${method}"` with `payload = { id, ...methodPayload }`
 *
 * @module StoreMessage
 */

import type { NonEmptyReadonlyArray } from "effect/Array";
import type { Brand } from "effect/Brand";
import * as Schema from "effect/Schema";

// ============================================================================
// Request ID
// ============================================================================

/** @public */
export type RequestId = bigint & Brand<"StoreTransport/RequestId">;

/** @public */
export const RequestId = (id: bigint | string): RequestId =>
  (typeof id === "bigint" ? id : BigInt(id)) as RequestId;

// ============================================================================
// Client → Server
// ============================================================================

/** @public */
export type FromClientEncoded =
  | RequestEncoded
  | AckEncoded
  | InterruptEncoded
  | Ping
  | Eof;

/**
 * Invoke a query or forQuery method.
 *
 * `tag`:
 * - query:    `"${processTag}/${method}"`
 * - forQuery: `"${processTag}/for/${method}"`
 *
 * For forQuery the `payload` is `{ id: string, payload: unknown }`.
 *
 * @public
 */
export interface RequestEncoded {
  readonly _tag: "Request";
  readonly id: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly headers: ReadonlyArray<[string, string]>;
  readonly traceId?: string | undefined;
  readonly spanId?: string | undefined;
  readonly sampled?: boolean | undefined;
}

/** @public */
export interface AckEncoded {
  readonly _tag: "Ack";
  readonly requestId: string;
}

/** @public */
export interface InterruptEncoded {
  readonly _tag: "Interrupt";
  readonly requestId: string;
}

/** @public */
export interface Ping {
  readonly _tag: "Ping";
}

/** @public */
export interface Eof {
  readonly _tag: "Eof";
}

/** @public */
export const constEof: Eof = { _tag: "Eof" };

/** @public */
export const constPing: Ping = { _tag: "Ping" };

// ============================================================================
// Server → Client
// ============================================================================

/** @public */
export type FromServerEncoded =
  | ResponseChunkEncoded
  | ResponseExitEncoded
  | ResponseDefectEncoded
  | Pong
  | ClientEnd;

/** @public */
export interface ResponseChunkEncoded {
  readonly _tag: "Chunk";
  readonly requestId: string;
  readonly values: NonEmptyReadonlyArray<unknown>;
}

/**
 * A single entry in a failure cause array. Matches `RpcMessage.ExitEncoded`
 * cause element format exactly for `layerProtocolFromRpc` compatibility.
 *
 * @public
 */
export type CauseEncoded =
  | { readonly _tag: "Fail"; readonly error: unknown }
  | { readonly _tag: "Die"; readonly defect: unknown }
  | { readonly _tag: "Interrupt"; readonly fiberId: number | undefined };

/**
 * Encoded wire form of an exit — `{ _tag: "Success", value }` or
 * `{ _tag: "Failure", cause: [...] }`. Cause is an array matching the
 * `RpcMessage.ExitEncoded` format.
 *
 * @public
 */
export type ExitEncoded =
  | { readonly _tag: "Success"; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly cause: ReadonlyArray<CauseEncoded> };

/** @public */
export interface ResponseExitEncoded {
  readonly _tag: "Exit";
  readonly requestId: string;
  readonly exit: ExitEncoded;
}

/** @public */
export interface ResponseDefectEncoded {
  readonly _tag: "Defect";
  readonly defect: unknown;
}

const encodeDefect = Schema.encodeSync(Schema.Defect());

/** @public */
export const makeResponseDefect = (
  input: unknown,
): ResponseDefectEncoded => ({
  _tag: "Defect",
  defect: encodeDefect(input),
});

/** @public */
export interface Pong {
  readonly _tag: "Pong";
}

/** @public */
export interface ClientEnd {
  readonly _tag: "ClientEnd";
  readonly clientId: number;
}

/** @public */
export const constPong: Pong = { _tag: "Pong" };

// ============================================================================
// Tag routing helpers
// ============================================================================

/** @public */
export type ParsedTag =
  | { readonly _tag: "query";    readonly facet: string; readonly method: string }
  | { readonly _tag: "forQuery"; readonly facet: string; readonly method: string };

/**
 * Parse a wire `tag` string into its facet, method, and query/forQuery kind.
 *
 * @public
 */
export const parseTag = (tag: string): ParsedTag => {
  const forIdx = tag.indexOf("/for/");
  if (forIdx !== -1) {
    return {
      _tag: "forQuery",
      facet: tag.slice(0, forIdx),
      method: tag.slice(forIdx + 5),
    };
  }
  const slashIdx = tag.lastIndexOf("/");
  return {
    _tag: "query",
    facet: tag.slice(0, slashIdx),
    method: tag.slice(slashIdx + 1),
  };
};

/**
 * Build a wire tag for a base query method.
 *
 * @public
 */
export const makeQueryTag = (facet: string, method: string): string =>
  `${facet}/${method}`;

/**
 * Build a wire tag for an identifier-bound (forQuery) method.
 *
 * @public
 */
export const makeForQueryTag = (facet: string, method: string): string =>
  `${facet}/for/${method}`;
