import { describe, expect, it } from "vitest";
import { Duration, Option } from "effect";
import {
  computeDisarmedIdleSleep,
  DEFAULT_SCHEDULE_POLL_WHILE_DISARMED,
  DISARMED_HINT_SLEEP_MAX,
  DISARMED_HINT_SLEEP_MIN,
  MIN_SCHEDULE_POLL_WHILE_DISARMED,
  resolveDisarmedFallbackPoll,
} from "../src/disarmedIdleSleep";
import { utcDateFromMillis } from "../src/internal/utcDate";

const expectDuration = (actual: Duration.Duration, expected: Duration.Duration) => {
  expect(Duration.equals(actual, expected)).toBe(true);
};

describe("resolveDisarmedFallbackPoll", () => {
  it("uses five-second default when unset", () => {
    expectDuration(resolveDisarmedFallbackPoll(undefined), DEFAULT_SCHEDULE_POLL_WHILE_DISARMED);
  });

  it.each([
    ["Duration.zero", Duration.zero],
    ["50 ms (below floor)", Duration.millis(50)],
    ["99 ms (below floor)", Duration.millis(99)],
  ] as const)("raises %s to the minimum floor", (_label, input) => {
    expectDuration(resolveDisarmedFallbackPoll(input), MIN_SCHEDULE_POLL_WHILE_DISARMED);
  });

  it("leaves exactly the floor unchanged", () => {
    expectDuration(
      resolveDisarmedFallbackPoll(MIN_SCHEDULE_POLL_WHILE_DISARMED),
      MIN_SCHEDULE_POLL_WHILE_DISARMED,
    );
  });

  it.each([
    ["1 second", Duration.seconds(1)],
    ["10 seconds", Duration.seconds(10)],
  ] as const)("preserves %s when already above the floor", (_label, d) => {
    expectDuration(resolveDisarmedFallbackPoll(d), d);
  });
});

describe("computeDisarmedIdleSleep", () => {
  const epoch = utcDateFromMillis(0);

  it("uses fallback when there is no transition hint (ignores long fallback in hint branch)", () => {
    expectDuration(
      computeDisarmedIdleSleep({
        now: epoch,
        nextScheduleTransition: Option.none(),
        fallbackPoll: Duration.seconds(12),
      }),
      Duration.seconds(12),
    );
  });

  it.each([
    {
      name: "500 ms ahead (below 1 s hint minimum)",
      now: epoch,
      next: utcDateFromMillis(500),
      fallback: Duration.seconds(99),
      want: DISARMED_HINT_SLEEP_MIN,
    },
    {
      name: "exactly 1 s ahead (on hint minimum)",
      now: epoch,
      next: utcDateFromMillis(1000),
      fallback: Duration.seconds(99),
      want: DISARMED_HINT_SLEEP_MIN,
    },
    {
      name: "30 s ahead (between min and max)",
      now: epoch,
      next: utcDateFromMillis(30_000),
      fallback: Duration.seconds(99),
      want: Duration.seconds(30),
    },
    {
      name: "hint in the past",
      now: utcDateFromMillis(10_000),
      next: utcDateFromMillis(5000),
      fallback: Duration.seconds(99),
      want: DISARMED_HINT_SLEEP_MIN,
    },
    {
      name: "hint equal to now",
      now: utcDateFromMillis(5000),
      next: utcDateFromMillis(5000),
      fallback: Duration.seconds(99),
      want: DISARMED_HINT_SLEEP_MIN,
    },
  ] as const)("$name", ({ now, next, fallback, want }) => {
    expectDuration(
      computeDisarmedIdleSleep({
        now,
        nextScheduleTransition: Option.some(next),
        fallbackPoll: fallback,
      }),
      want,
    );
  });

  it("caps deltas above the hint maximum", () => {
    const far = utcDateFromMillis(epoch.getTime() + 60 * 60 * 1000);
    expectDuration(
      computeDisarmedIdleSleep({
        now: epoch,
        nextScheduleTransition: Option.some(far),
        fallbackPoll: Duration.seconds(1),
      }),
      DISARMED_HINT_SLEEP_MAX,
    );
  });

  it("uses hint maximum when delta equals cap (5 minutes)", () => {
    const exactly = utcDateFromMillis(
      epoch.getTime() + Duration.toMillis(DISARMED_HINT_SLEEP_MAX),
    );
    expectDuration(
      computeDisarmedIdleSleep({
        now: epoch,
        nextScheduleTransition: Option.some(exactly),
        fallbackPoll: Duration.seconds(1),
      }),
      DISARMED_HINT_SLEEP_MAX,
    );
  });

  it("when some(next) is chosen, ignores an enormous fallback (hint path wins)", () => {
    expectDuration(
      computeDisarmedIdleSleep({
        now: epoch,
        nextScheduleTransition: Option.some(utcDateFromMillis(5000)),
        fallbackPoll: Duration.hours(24),
      }),
      Duration.seconds(5),
    );
  });
});
