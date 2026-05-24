import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { ProcessSchedule } from "../src";
import { utcDateFromMillis } from "../src/internal/utcDate";

describe("ProcessSchedule.inMemory", () => {
  it.effect("lists initial entries by process", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      const entries = yield* schedule.entries;
      expect(entries.length).toBe(1);
      expect(Option.getOrNull(entries[0]?.id ?? Option.none())).toBe("a1");
      expect(Option.isNone(entries[0]?.stopAt ?? Option.none())).toBe(true);
    }).pipe(Effect.provide(ProcessSchedule.inMemory([
      ProcessSchedule.at("a1", utcDateFromMillis(0)),
    ]))),
  );

  it.effect("replace and get update process schedules", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      yield* schedule.set([
        ProcessSchedule.at("a1", utcDateFromMillis(100)),
        ProcessSchedule.window("a2", utcDateFromMillis(200), utcDateFromMillis(500)),
      ]);

      const entries = yield* schedule.entries;
      expect(entries.length).toBe(2);
      expect(Option.getOrNull(entries[1]?.id ?? Option.none())).toBe("a2");
      expect(entries[1]?.startAt.getTime()).toBe(200);
    }).pipe(Effect.provide(ProcessSchedule.inMemory())),
  );

  it.effect("empty starts with no entries", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      const entries = yield* schedule.entries;
      expect(entries.length).toBe(0);
    }).pipe(Effect.provide(ProcessSchedule.empty)),
  );

  it.effect("append/clear mutate schedules", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      yield* schedule.add(ProcessSchedule.at("a1", utcDateFromMillis(0)));
      expect((yield* schedule.entries).length).toBe(1);

      yield* schedule.clear;
      expect((yield* schedule.entries).length).toBe(0);
    }).pipe(Effect.provide(ProcessSchedule.inMemory())),
  );

  it.effect("changed completes after a schedule mutation", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      const waiter = yield* Effect.forkChild(schedule.changed);
      yield* Effect.yieldNow;
      yield* schedule.add(ProcessSchedule.at("wake", utcDateFromMillis(0)));
      yield* Effect.yieldNow;
      const exit = yield* Fiber.await(waiter);
      expect(exit._tag).toBe("Success");
    }).pipe(Effect.provide(ProcessSchedule.inMemory()), Effect.scoped),
  );

  it.effect("constructor overloads support id-first and id-less forms", () =>
    Effect.gen(function* () {
      const idlessAt = ProcessSchedule.at(utcDateFromMillis(100));
      const namedAt = ProcessSchedule.at("match-1", utcDateFromMillis(200));
      const idlessWindow = ProcessSchedule.window(utcDateFromMillis(300), utcDateFromMillis(400));
      const namedWindow = ProcessSchedule.window(
        "match-2",
        utcDateFromMillis(500),
        utcDateFromMillis(600),
      );

      expect(Option.isNone(idlessAt.id)).toBe(true);
      expect(Option.getOrNull(namedAt.id)).toBe("match-1");
      expect(Option.isNone(idlessWindow.id)).toBe(true);
      expect(Option.getOrNull(namedWindow.id)).toBe("match-2");
      expect(Option.getOrNull(namedWindow.stopAt)?.getTime()).toBe(600);
    }),
  );

  it.effect("define composes entries with all(...) without array wrappers", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      const entries = yield* schedule.entries;

      expect(entries.length).toBe(3);
      expect(Option.getOrNull(entries[0]?.id ?? Option.none())).toBe("a");
      expect(Option.getOrNull(entries[1]?.id ?? Option.none())).toBe("b");
      expect(Option.getOrNull(entries[2]?.id ?? Option.none())).toBe("c");
    }).pipe(
      Effect.provide(ProcessSchedule.define(({ all, at, window }) =>
        all(
          at("a", utcDateFromMillis(100)),
          window("b", utcDateFromMillis(200), utcDateFromMillis(300)),
          at("c", utcDateFromMillis(400)),
        ))),
    ),
  );
});
