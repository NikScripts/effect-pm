/**
 * Log **annotation keys** + per-scope annotation helpers for hyperlink-ts log capture.
 *
 * Every captured {@link LogEntry} carries annotations keyed by {@link LogAnnotationKeys}. Values are
 * either a **node log key** (`Node.Tag.key`) or **lineage segment keys** (`Hyperlink.Tag.key`).
 *
 * Full catalog: `docs/LOGS.md` — Annotation keys.
 *
 * Hyperlink kind (process vs queue vs …) is {@link Hyperlink.kindOf} on the tag — not an annotation.
 *
 * @module LogContext
 */

import { Effect } from "effect";

/**
 * Standard **annotation key** names on {@link LogEntry.annotations}.
 *
 * | Property | Annotation key (field name) | Value is |
 * |----------|----------------------------|----------|
 * | `node` | `"node"` | **node log key** (`Node.Tag.key`) |
 * | `lineage` | `"hyperlink-ts/lineage"` | JSON array of **lineage segment keys** |
 * | `lineId` | `"hyperlink-ts/lineId"` | Stable id for one published relay line (memo / dedupe) |
 *
 * Package: `hyperlink-ts/LogContext` · Source: `src/LogContext.ts` · See `docs/LOGS.md`.
 *
 * @category utils
 * @public
 */
export const LogAnnotationKeys = {
  /** Annotation key whose value is the **node log key**. */
  node: "node",
  /** Annotation key whose value is JSON **lineage segment keys**. */
  lineage: "hyperlink-ts/lineage",
  /** Annotation key whose value is the stable **line id** stamped at relay publish. */
  lineId: "hyperlink-ts/lineId",
} as const;

/**
 * Annotate every log line with a **node log key** value under annotation key {@link LogAnnotationKeys.node}.
 * Applied by node durable tails (`Node.logs` / `Hyperlink.store(Node)` in `resource-web/server.ts`).
 *
 * @param node - **Node log key** value (`Node.Tag.key`).
 *
 * @category utils
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
