/**
 * Pure policy for how long a {@link Process} supervisor sleeps while the
 * schedule gate is disarmed (before re-reading {@link ProcessScheduleService.status}).
 *
 * @remarks
 * Re-exported from the package root for tests and custom {@link ProcessSchedule}
 * implementations that want identical clamping rules.
 *
 * @module disarmedIdleSleep
 */

import { Duration, Option } from "effect";

/** When the schedule does not supply `nextScheduleTransition`. */
/** @public */
export const DEFAULT_SCHEDULE_POLL_WHILE_DISARMED = Duration.seconds(5);

/**
 * Lower bound for configured disarmed fallback polls so `Duration.zero`
 * or negative durations cannot create a busy loop.
 */
/** @public */
export const MIN_SCHEDULE_POLL_WHILE_DISARMED = Duration.millis(100);

/** When a hint date is in the past or equal to “now”, re-check after this delay. */
/** @public */
export const DISARMED_HINT_SLEEP_MIN = Duration.seconds(1);

/** Upper bound so refreshed cron hints are picked up even if a stale date was far out. */
/** @public */
export const DISARMED_HINT_SLEEP_MAX = Duration.minutes(5);

/** @public */
export const resolveDisarmedFallbackPoll = (
  configured: Duration.Duration | undefined,
): Duration.Duration =>
  Duration.max(configured ?? DEFAULT_SCHEDULE_POLL_WHILE_DISARMED, MIN_SCHEDULE_POLL_WHILE_DISARMED);

/**
 * How long to sleep before the next `status` read while disarmed.
 *
 * @remarks
 * - **`nextScheduleTransition: none`** — use the caller-resolved fallback (already clamped).
 * - **`some(next)`** — sleep until `next` relative to `now`, clamped to
 *   {@link DISARMED_HINT_SLEEP_MIN}–{@link DISARMED_HINT_SLEEP_MAX}. If `next` is not after
 *   `now`, use {@link DISARMED_HINT_SLEEP_MIN} so arm flips are noticed without spinning.
 *
 * @public
 */
export const computeDisarmedIdleSleep = (args: {
  readonly now: Date;
  readonly nextScheduleTransition: Option.Option<Date>;
  readonly fallbackPoll: Duration.Duration;
}): Duration.Duration => {
  const { now, nextScheduleTransition, fallbackPoll } = args;
  return Option.match(nextScheduleTransition, {
    onNone: () => fallbackPoll,
    onSome: (next) => {
      const diffMs = next.getTime() - now.getTime();
      if (diffMs <= 0) {
        return DISARMED_HINT_SLEEP_MIN;
      }
      const raw = Duration.millis(diffMs);
      return Duration.clamp(raw, {
        minimum: DISARMED_HINT_SLEEP_MIN,
        maximum: DISARMED_HINT_SLEEP_MAX,
      });
    },
  });
};
