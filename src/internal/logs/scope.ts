/**
 * Log scope annotation — lineage reducer for resource materialization.
 *
 * @module internal/logs/scope
 * @internal
 */

import { Effect } from "effect";
import { LogAnnotationKeys } from "../../LogContext";
import type { StoreScopeTag } from "../store/registration";

/**
 * Append `tag.key` to the fiber lineage annotation.
 *
 * @remarks
 * Full reducer (read-merge-write of the JSON lineage array) lands when engines call this at
 * materialize; today each scoped block stamps a single-key lineage for the resource.
 *
 * @internal
 */
export const withLogScope =
  <Tag extends StoreScopeTag>(tag: Tag) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.annotateLogs(effect, {
      [LogAnnotationKeys.lineage]: JSON.stringify([tag.key]),
    });
