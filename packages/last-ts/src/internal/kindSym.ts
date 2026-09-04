/**
 * Shared factory-brand key — kept out of `Last.ts` so `View` can stamp without
 * importing `Last` (breaks View → Last → … → Link → View TDZ on `kindSym`).
 *
 * @internal
 */
export const kindSym: unique symbol = Symbol.for("last-ts/Last/kind");
