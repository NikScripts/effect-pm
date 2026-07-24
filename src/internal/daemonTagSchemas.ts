/**
 * Wire schemas stamped on {@link Daemon.Tag} factories (`success` / `error` slots).
 *
 * @module internal/daemonTagSchemas
 * @internal
 */

import type { Schema } from "effect";

export const successSym: unique symbol = Symbol.for(
  "hyperlink-ts/Daemon/success",
);

export const errorSym: unique symbol = Symbol.for(
  "hyperlink-ts/Daemon/error",
);

/** Read a wire schema stamped on a daemon tag. @internal */
export const schemaOf = (
  tag: unknown,
  sym: typeof successSym | typeof errorSym,
): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    sym in tag
  ) {
    return (tag as { readonly [K in typeof sym]?: Schema.Top })[sym];
  }
  return undefined;
};

/** @internal */
export const successOf = (tag: unknown): Schema.Top | undefined =>
  schemaOf(tag, successSym);

/** @internal */
export const errorOf = (tag: unknown): Schema.Top | undefined =>
  schemaOf(tag, errorSym);
