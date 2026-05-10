import { describe, expect, it } from "@effect/vitest";
import { Cron, Duration, Effect, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { ProcessSchedule } from "../src";

describe("ProcessSchedule.alwaysArmed", () => {
  it.effect("armed is true and status reports armed with no transition hint", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      expect(yield* schedule.armed).toBe(true);
      const st = yield* schedule.status;
      expect(st.armed).toBe(true);
      expect(Option.isNone(st.nextScheduleTransition)).toBe(true);
    }).pipe(Effect.provide(ProcessSchedule.alwaysArmed)),
  );
});

describe("ProcessSchedule.fromArmedRef", () => {
  it.effect("without transition ref, status always reports none for nextScheduleTransition", () =>
    Effect.gen(function* () {
      const armed = yield* Ref.make(true);
      const layer = ProcessSchedule.fromArmedRef({ armed });

      yield* Effect.gen(function* () {
        const schedule = yield* ProcessSchedule;
        const st = yield* schedule.status;
        expect(st.armed).toBe(true);
        expect(Option.isNone(st.nextScheduleTransition)).toBe(true);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("armed and optional nextScheduleTransition track external refs", () =>
    Effect.gen(function* () {
      const armed = yield* Ref.make(false);
      const transition = yield* Ref.make<Option.Option<Date>>(Option.none());
      const layer = ProcessSchedule.fromArmedRef({
        armed,
        nextScheduleTransition: transition,
      });

      yield* Effect.gen(function* () {
        const schedule = yield* ProcessSchedule;

        expect(yield* schedule.armed).toBe(false);
        const st0 = yield* schedule.status;
        expect(st0.armed).toBe(false);
        expect(Option.isNone(st0.nextScheduleTransition)).toBe(true);

        yield* Ref.set(armed, true);
        expect(yield* schedule.armed).toBe(true);

        const at = new Date("2026-06-01T12:00:00.000Z");
        yield* Ref.set(transition, Option.some(at));
        const st1 = yield* schedule.status;
        expect(st1.armed).toBe(true);
        expect(Option.getOrNull(st1.nextScheduleTransition)).toEqual(at);
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("ProcessSchedule.cronMatch", () => {
  it.effect("recomputes armed from the runtime Clock (follows TestClock)", () =>
    Effect.gen(function* () {
      const cron = Cron.parseUnsafe("0 * * * * *");
      const scheduleLayer = ProcessSchedule.cronMatch({
        crons: cron,
        sampleInterval: Duration.millis(20),
      });

      yield* Effect.gen(function* () {
        const schedule = yield* ProcessSchedule;

        expect(yield* schedule.armed).toBe(true);

        yield* TestClock.adjust(Duration.seconds(30));
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(yield* schedule.armed).toBe(false);

        yield* TestClock.adjust(Duration.seconds(30));
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(yield* schedule.armed).toBe(true);
      }).pipe(Effect.provide(scheduleLayer), Effect.scoped);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
