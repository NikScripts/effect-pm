/**
 * Read result / error schemas stamped on {@link Process.Tag} factories.
 *
 * @module internal/processTagSchemas
 * @internal
 */

import type { Schema } from "effect";

export const resultSchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Process/resultSchema",
);

export const errorSchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Process/errorSchema",
);

/** @internal */
export const resultSchemaOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    resultSchemaSym in tag
  ) {
    return (tag as { readonly [resultSchemaSym]?: Schema.Top })[resultSchemaSym];
  }
  return undefined;
};

/** @internal */
export const errorSchemaOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    errorSchemaSym in tag
  ) {
    return (tag as { readonly [errorSchemaSym]?: Schema.Top })[errorSchemaSym];
  }
  return undefined;
};
