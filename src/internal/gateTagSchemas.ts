/**
 * Wire schemas stamped on {@link Gate.Tag} / {@link Gate.Service} factories.
 *
 * @module internal/gateTagSchemas
 * @internal
 */

import { Schema } from "effect";

export const successSym: unique symbol = Symbol.for(
  "hyperlink-ts/Gate/success",
);

export const errorSym: unique symbol = Symbol.for(
  "hyperlink-ts/Gate/error",
);

/** Stable Tag metadata — rate-limit bucket key (not under the renameable nest). */
export const rateLimitKeySym: unique symbol = Symbol.for(
  "hyperlink-ts/Gate/rateLimitKey",
);

/** Stable Tag metadata — wire nest path for limiter fields (v1 `"metrics"`). */
export const metricsKeySym: unique symbol = Symbol.for(
  "hyperlink-ts/Gate/metricsKey",
);

/**
 * Stamp `success` / `error` wire schemas onto a gate tag. `Object.assign`'s in-place mutation is
 * returned as the same `T` — no cast (mirrors `stampQueueWireSchemas`). `error` is only stamped when
 * it is a real (non-{@link Schema.Never}) schema, so `errorOf` stays `undefined` for infallible gates.
 * @internal
 */
export const stampGateWireSchemas = <T extends object>(
  tag: T,
  schemas: { readonly success?: Schema.Top; readonly error?: Schema.Top },
): T => {
  if (schemas.success !== undefined) {
    Object.assign(tag, { [successSym]: schemas.success });
  }
  if (schemas.error !== undefined && schemas.error !== Schema.Never) {
    Object.assign(tag, { [errorSym]: schemas.error });
  }
  return tag;
};

/**
 * Stamp stable limiter metadata on a gate tag (widget discovery — not nest path).
 *
 * @internal
 */
export const stampGateMetricsMetadata = <T extends object>(
  tag: T,
  meta: {
    readonly rateLimitKey?: string | undefined;
    readonly metricsKey?: string | undefined;
  },
): T => {
  if (meta.rateLimitKey !== undefined) {
    Object.assign(tag, { [rateLimitKeySym]: meta.rateLimitKey });
  }
  if (meta.metricsKey !== undefined) {
    Object.assign(tag, { [metricsKeySym]: meta.metricsKey });
  }
  return tag;
};

/** Read stamped rate-limit bucket key, if any. @internal */
export const rateLimitKeyOf = (tag: unknown): string | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    rateLimitKeySym in tag
  ) {
    const value = tag[rateLimitKeySym];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
};

/** Read stamped metrics nest key (defaults to `"metrics"` when absent). @internal */
export const metricsKeyOf = (tag: unknown): string => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    metricsKeySym in tag
  ) {
    const value = tag[metricsKeySym];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "metrics";
};

/** Read the `success` schema stamped on a gate tag, if any. @internal */
export const successOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    successSym in tag
  ) {
    const value = tag[successSym];
    return Schema.isSchema(value) ? value : undefined;
  }
  return undefined;
};

/** Read the `error` schema stamped on a gate tag, if any. @internal */
export const errorOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    errorSym in tag
  ) {
    const value = tag[errorSym];
    return Schema.isSchema(value) ? value : undefined;
  }
  return undefined;
};
