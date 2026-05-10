import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { ProcessSchedule } from "../src";

describe("ProcessSchedule.inMemory", () => {
  it.effect("lists initial entries by process", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      const entries = yield* schedule.entries;
      expect(entries.length).toBe(1);
      expect(Option.getOrNull(entries[0]?.id ?? Option.none())).toBe("a1");
      expect(Option.isNone(entries[0]?.stopAt ?? Option.none())).toBe(true);
    }).pipe(Effect.provide(ProcessSchedule.inMemory([
      ProcessSchedule.at("a1", new Date(0)),
    ]))),
  );

  it.effect("replace and get update process schedules", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      yield* schedule.set([
        ProcessSchedule.at("a1", new Date(100)),
        ProcessSchedule.window("a2", new Date(200), new Date(500)),
      ]);

      const entries = yield* schedule.entries;
      expect(entries.length).toBe(2);
      expect(Option.getOrNull(entries[1]?.id ?? Option.none())).toBe("a2");
      expect(entries[1]?.startAt.getTime()).toBe(200);
    }).pipe(Effect.provide(ProcessSchedule.inMemory())),
  );

  it.effect("append/clear mutate schedules", () =>
    Effect.gen(function* () {
      const schedule = yield* ProcessSchedule;
      yield* schedule.add(ProcessSchedule.at("a1", new Date(0)));
      expect((yield* schedule.entries).length).toBe(1);

      yield* schedule.clear;
      expect((yield* schedule.entries).length).toBe(0);
    }).pipe(Effect.provide(ProcessSchedule.inMemory())),
  );
});
