import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
// The engine schedule primitive is internal now (its public face is `Daemon.scheduleInMemory` /
// `scheduleDefine` + the `Daemon.Schedule` resource); this suite exercises the primitive itself, so
// it imports the internal module directly.
import { DaemonSchedule } from "../src/internal/daemonSchedule";
import { utcDateFromMillis } from "../src/internal/utcDate";

describe("engine schedule primitive (internal)", () => {
  it.effect("lists initial entries by process", () =>
    Effect.gen(function* () {
      const schedule = yield* DaemonSchedule;
      const entries = yield* schedule.entries;
      expect(entries.length).toBe(1);
      expect(Option.getOrNull(entries[0]?.id ?? Option.none())).toBe("a1");
      expect(Option.isNone(entries[0]?.stopAt ?? Option.none())).toBe(true);
    }).pipe(Effect.provide(DaemonSchedule.inMemory([
      DaemonSchedule.at("a1", utcDateFromMillis(0)),
    ]))),
  );

  it.effect("replace and get update process schedules", () =>
    Effect.gen(function* () {
      const schedule = yield* DaemonSchedule;
      yield* schedule.set([
        DaemonSchedule.at("a1", utcDateFromMillis(100)),
        DaemonSchedule.window("a2", utcDateFromMillis(200), utcDateFromMillis(500)),
      ]);

      const entries = yield* schedule.entries;
      expect(entries.length).toBe(2);
      expect(Option.getOrNull(entries[1]?.id ?? Option.none())).toBe("a2");
      expect(entries[1]?.startAt.getTime()).toBe(200);
    }).pipe(Effect.provide(DaemonSchedule.inMemory())),
  );

  it.effect("empty starts with no entries", () =>
    Effect.gen(function* () {
      const schedule = yield* DaemonSchedule;
      const entries = yield* schedule.entries;
      expect(entries.length).toBe(0);
    }).pipe(Effect.provide(DaemonSchedule.empty)),
  );

  it.effect("append/clear mutate schedules", () =>
    Effect.gen(function* () {
      const schedule = yield* DaemonSchedule;
      yield* schedule.add(DaemonSchedule.at("a1", utcDateFromMillis(0)));
      expect((yield* schedule.entries).length).toBe(1);

      yield* schedule.clear;
      expect((yield* schedule.entries).length).toBe(0);
    }).pipe(Effect.provide(DaemonSchedule.inMemory())),
  );

  it.effect("changed completes after a schedule mutation", () =>
    Effect.gen(function* () {
      const schedule = yield* DaemonSchedule;
      const waiter = yield* Effect.forkChild(schedule.changed);
      yield* Effect.yieldNow;
      yield* schedule.add(DaemonSchedule.at("wake", utcDateFromMillis(0)));
      yield* Effect.yieldNow;
      const exit = yield* Fiber.await(waiter);
      expect(exit._tag).toBe("Success");
    }).pipe(Effect.provide(DaemonSchedule.inMemory()), Effect.scoped),
  );

  it.effect("constructor overloads support id-first and id-less forms", () =>
    Effect.gen(function* () {
      const idlessAt = DaemonSchedule.at(utcDateFromMillis(100));
      const namedAt = DaemonSchedule.at("match-1", utcDateFromMillis(200));
      const idlessWindow = DaemonSchedule.window(utcDateFromMillis(300), utcDateFromMillis(400));
      const namedWindow = DaemonSchedule.window(
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
      const schedule = yield* DaemonSchedule;
      const entries = yield* schedule.entries;

      expect(entries.length).toBe(3);
      expect(Option.getOrNull(entries[0]?.id ?? Option.none())).toBe("a");
      expect(Option.getOrNull(entries[1]?.id ?? Option.none())).toBe("b");
      expect(Option.getOrNull(entries[2]?.id ?? Option.none())).toBe("c");
    }).pipe(
      Effect.provide(DaemonSchedule.define(({ all, at, window }) =>
        all(
          at("a", utcDateFromMillis(100)),
          window("b", utcDateFromMillis(200), utcDateFromMillis(300)),
          at("c", utcDateFromMillis(400)),
        ))),
    ),
  );
});
