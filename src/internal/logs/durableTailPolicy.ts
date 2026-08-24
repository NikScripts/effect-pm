/**
 * Pure predicates for durable log store tails — level floor ∧ match.
 *
 * @module internal/logs/durableTailPolicy
 * @internal
 */

import { LogLevel, Predicate } from "effect";
import type { LogEntry } from "../../LogEntry";
import type { StoreLogLevel } from "../store/types";

/**
 * Store export floor → Effect {@link LogLevel} gate. `"All"` / `"None"` are store vocabulary.
 *
 * @internal
 */
export const meetsStoreLevel = (
  floor: StoreLogLevel,
): Predicate.Predicate<LogEntry> => {
  if (floor === "All") {
    return (): boolean => true;
  }
  if (floor === "None") {
    return (): boolean => false;
  }
  return (entry) => LogLevel.isGreaterThanOrEqualTo(entry.level, floor);
};

/**
 * Combine store level floor with a scope match predicate.
 *
 * @internal
 */
export const durableTailPolicy = (options: {
  readonly storeLevel: StoreLogLevel;
  readonly match: Predicate.Predicate<LogEntry>;
}): Predicate.Predicate<LogEntry> =>
  Predicate.and(meetsStoreLevel(options.storeLevel), options.match);
