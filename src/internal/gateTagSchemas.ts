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

/**
 * Stamp `success` / `error` wire schemas onto a gate tag. `Object.assign`'s in-place mutation is
 * returned as the same `T` — no cast (mirrors `stampQueueWireSchemas`). `error` is only stamped when
 * it is a real (non-{@link Schema.Never}) schema, so `errorOf` stays `undefined` for infallible gates.
 * @internal
 */
export const stampRunWireSchemas = <T extends object>(
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
