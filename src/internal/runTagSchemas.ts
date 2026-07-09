/**
 * Wire schemas stamped on {@link RunResource.Tag} / {@link RunResource.Service} factories.
 *
 * @module internal/runTagSchemas
 * @internal
 */

import { Schema } from "effect";

export const successSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/RunResource/success",
);

export const errorSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/RunResource/error",
);

/** Read the `success` schema stamped on a run gate tag, if any. @internal */
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

/** Read the `error` schema stamped on a run gate tag, if any. @internal */
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
