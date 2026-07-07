/**
 * Wire schemas stamped on {@link Process.Tag} factories (`success` / `error` slots).
 *
 * @module internal/processTagSchemas
 * @internal
 */

import type { Schema } from "effect";

export const successSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Process/success",
);

export const errorSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Process/error",
);

/** @internal */
export const successOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    successSym in tag
  ) {
    return (tag as { readonly [successSym]?: Schema.Top })[successSym];
  }
  return undefined;
};

/** @internal */
export const errorOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    errorSym in tag
  ) {
    return (tag as { readonly [errorSym]?: Schema.Top })[errorSym];
  }
  return undefined;
};
