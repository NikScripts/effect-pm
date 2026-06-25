import { DateTime, Duration, Effect, Ref } from "effect";
import { expect, it } from "vitest";
import { ProcessResource } from "../src/ProcessContract";
import { ProcessSchedule } from "../src/ProcessSchedule";

// A managed process as a toolkit resource — driven through the same `yield* Tag` surface a
// remote consumer uses (only the provided layer differs). By default a process is armed and runs
// immediately; these tests pass `schedule: ProcessSchedule.empty` to start disarmed where they
// want to observe `runImmediately` / schedule CRUD in isolation.
class TestProc extends ProcessResource.Tag<TestProc>()("test/process-contract/Proc") {}

it("with the default schedule a process arms and runs its effect immediately", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const proc = yield* TestProc;
        // wait for the supervisor to arm + run the always-open window once
        yield* Effect.gen(function* () {
          while ((yield* Ref.get(ran)) < 1) yield* Effect.sleep(Duration.millis(5));
        }).pipe(Effect.timeout(Duration.seconds(1)));
        expect(yield* Ref.get(ran)).toBeGreaterThanOrEqual(1);
        expect((yield* proc.statusNow).armed).toBe(true);
      }).pipe(
        Effect.provide(
          ProcessResource.layer(TestProc, { effect: Ref.update(ran, (n) => n + 1) }),
        ),
      );
    }),
  ));

it("runImmediately runs the effect once (disarmed via schedule: empty)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const proc = yield* TestProc;
        const before = yield* proc.statusNow;
        expect(before.supervising).toBe(true);
        expect(before.armed).toBe(false);
        expect(before.activeInstances).toBe(0);

        yield* proc.runImmediately;
        expect(yield* Ref.get(ran)).toBe(1);

        // run metrics increment at the single run boundary
        const after = yield* proc.statusNow;
        expect(after.runsStarted).toBe(1);
        expect(after.runsSucceeded).toBe(1);
        expect(after.runsFailed).toBe(0);
        expect(after.lastRunStartedAt).toBeDefined();
        expect(typeof after.lastRunDurationMillis).toBe("number");
      }).pipe(
        Effect.provide(
          ProcessResource.layer(TestProc, {
            effect: Ref.update(ran, (n) => n + 1),
            schedule: ProcessSchedule.empty,
          }),
        ),
      );
    }),
  ));

it("schedule round-trips through set/add/clear and the read verb", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* TestProc;
      const future = DateTime.makeUnsafe(4_102_444_800_000); // 2100-01-01, fixed far-future

      yield* proc.setSchedule([{ id: "e1", startAt: future }]);
      let entries = yield* proc.schedule;
      expect(entries.map((e) => e.id)).toEqual(["e1"]);

      yield* proc.addSchedule({ id: "e2", startAt: future });
      entries = yield* proc.schedule;
      expect(entries.map((e) => e.id).sort()).toEqual(["e1", "e2"]);

      yield* proc.clearSchedule;
      entries = yield* proc.schedule;
      expect(entries).toEqual([]);
    }).pipe(
      Effect.provide(
        ProcessResource.layer(TestProc, {
          effect: Effect.void,
          schedule: ProcessSchedule.empty,
        }),
      ),
    ),
  ));

it("stop/start toggles supervision (observable via statusNow.supervising)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* TestProc;
      expect((yield* proc.statusNow).supervising).toBe(true);

      yield* proc.stop;
      expect((yield* proc.statusNow).supervising).toBe(false);

      yield* proc.start;
      expect((yield* proc.statusNow).supervising).toBe(true);
    }).pipe(
      Effect.provide(ProcessResource.layer(TestProc, { effect: Effect.void })),
    ),
  ));
