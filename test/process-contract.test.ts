import { DateTime, Effect, Ref } from "effect";
import { expect, it } from "vitest";
import { ProcessResource } from "../src/ProcessContract";

// A managed process as a toolkit resource — driven through the same `yield* Tag` surface a
// remote consumer uses (only the provided layer differs). Default schedule is an empty in-memory
// store (disarmed), so the user effect runs only via `runImmediately` here.
class TestProc extends ProcessResource.Tag<TestProc>()("test/process-contract/Proc") {}

it("runImmediately runs the effect once; statusNow reflects the auto-started driver", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const proc = yield* TestProc;
        // auto-started on layer build, empty schedule → disarmed, no triggers
        const before = yield* proc.statusNow;
        expect(before.supervising).toBe(true);
        expect(before.armed).toBe(false);
        expect(before.activeInstances).toBe(0);

        yield* proc.runImmediately;
        expect(yield* Ref.get(ran)).toBe(1);
      }).pipe(
        Effect.provide(
          ProcessResource.layer(TestProc, {
            effect: Ref.update(ran, (n) => n + 1),
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
      Effect.provide(ProcessResource.layer(TestProc, { effect: Effect.void })),
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
