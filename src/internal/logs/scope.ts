/**
 * Log scope annotation — lineage reducer for resource materialization.
 *
 * @module internal/logs/scope
 * @internal
 */

import { Effect } from "effect";
import { CurrentLogAnnotations } from "effect/References";
import { LogAnnotationKeys } from "../../LogContext";
import type { StoreScopeTag } from "../store/registration";

/** Decode the JSON lineage array from a fiber annotation value. @internal */
const parseLineageAnnotation = (raw: unknown): ReadonlyArray<string> => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // ignore malformed lineage
  }
  return [];
};

/**
 * Append `tag.key` onto the fiber's lineage annotation (read → append → write).
 *
 * @remarks
 * Uses {@link CurrentLogAnnotations} via `Effect.updateService` so nested
 * {@link withLogScope} calls **combine** into a path instead of replacing the
 * prior array. Idempotent when `tag.key` is already the last segment. Does **not**
 * auto-inject a node root — node journal identity stays on `annotations.node`.
 *
 * @internal
 */
export const withLogScope =
  <Tag extends StoreScopeTag>(tag: Tag) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.updateService(effect, CurrentLogAnnotations, (annotations) => {
      const prior = parseLineageAnnotation(annotations[LogAnnotationKeys.lineage]);
      const next =
        prior[prior.length - 1] === tag.key ? prior : [...prior, tag.key];
      return {
        ...annotations,
        [LogAnnotationKeys.lineage]: JSON.stringify(next),
      };
    });
