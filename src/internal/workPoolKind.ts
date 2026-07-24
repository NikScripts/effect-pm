/**
 * @module internal/workPoolKind
 */

/**
 * The WorkPool resource kind — the single source of truth, re-exported publicly as
 * `WorkPool.kind`. It lives in its own leaf module so both the light `WorkPool.Tag` path
 * and the engine (which stamps it onto every definition) import the one value without the
 * Tag path dragging in the engine. The process manager / dashboard match on it; there is no
 * second short discriminator.
 *
 * @public
 */
export const kind = "hyperlink-ts/WorkPool" as const;
