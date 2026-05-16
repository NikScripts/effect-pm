/**
 * Storage-neutral event row shapes shared by ProcessStore adapters.
 *
 * @module ProcessStore/Event
 */

/**
 * Structural JSON value compatible with persisted event payloads.
 *
 * @public
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

/**
 * Row shape persisted by storage adapters.
 *
 * @public
 */
export interface EffectPmEventRow {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly entityType: string;
  readonly entityId: string;
  readonly attributes: JsonValue | null;
  readonly payload: JsonValue;
  readonly createdAt: Date;
}

/**
 * Create input used by append-style storage adapters.
 *
 * @internal
 */
export interface EffectPmEventCreateInput {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly entityType: string;
  readonly entityId: string;
  readonly attributes?: JsonValue | null;
  readonly payload: JsonValue;
}
