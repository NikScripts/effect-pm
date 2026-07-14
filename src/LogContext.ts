/**
 * Log **annotation keys** + per-scope annotation helpers for effect-pm log capture.
 *
 * Every captured {@link LogEntry} carries annotations keyed by {@link LogAnnotationKeys}. Values are
 * either a **node log key** (`Resource.Node.key`) or **lineage segment keys** (`Resource.Tag.key`).
 *
 * Full catalog: `docs/LOGS.md` — Annotation keys.
 *
 * Resource kind (process vs queue vs …) is {@link Resource.kindOf} on the tag — not an annotation.
 *
 * @module LogContext
 */

import { Effect } from "effect";

/**
 * Standard **annotation key** names on {@link LogEntry.annotations}.
 *
 * | Property | Annotation key (field name) | Value is |
 * |----------|----------------------------|----------|
 * | `node` | `"node"` | **node log key** (`Resource.Node.key`) |
 * | `lineage` | `"@nikscripts/effect-pm/lineage"` | JSON array of **lineage segment keys** |
 * | `lineId` | `"@nikscripts/effect-pm/lineId"` | Stable id for one published relay line (memo / dedupe) |
 *
 * Package: `@nikscripts/effect-pm/LogContext` · Source: `src/LogContext.ts` · See `docs/LOGS.md`.
 *
 * @public
 */
export const LogAnnotationKeys = {
  /** Annotation key whose value is the **node log key**. */
  node: "node",
  /** Annotation key whose value is JSON **lineage segment keys**. */
  lineage: "@nikscripts/effect-pm/lineage",
  /** Annotation key whose value is the stable **line id** stamped at relay publish. */
  lineId: "@nikscripts/effect-pm/lineId",
} as const;

/**
 * Annotate every log line with a **node log key** value under annotation key {@link LogAnnotationKeys.node}.
 * Applied by node durable tails (`Node.logs` / `Resource.store(Node)` in `resource-web/server.ts`).
 *
 * @param node - **Node log key** value (`Resource.Node.key`).
 *
 * @public
 */
export const withNodeLogAnnotations = <A, E, R>(
  node: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, { [LogAnnotationKeys.node]: node });

/**
 * Log annotation keys, aliased as `LogContext.keys` for discoverability alongside the
 * per-scope annotation helpers above.
 *
 * @public
 */
export { LogAnnotationKeys as keys };
