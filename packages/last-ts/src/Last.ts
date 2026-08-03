/**
 * @module Last
 *
 * Cross-cutting Last.ts handle introspection. Factory brands are stamped with
 * {@link kindSym} and read with {@link kindOf} — not public props on the Tag.
 */

/**
 * Where a handle’s **factory brand** is stowed (e.g. `last-ts/View`).
 * Set by each module’s Tag mint; read with {@link kindOf}.
 *
 * @internal
 */
export const kindSym: unique symbol = Symbol.for("last-ts/Last/kind");

/**
 * The factory brand a handle was minted for (e.g. `last-ts/View`).
 * `undefined` when `tag` was not stamped by Last.
 *
 * @category introspection
 * @public
 */
export const kindOf = (tag: unknown): string | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    kindSym in tag
  ) {
    const value = (tag as { readonly [kindSym]: unknown })[kindSym];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
};
