import { DateTime, Duration, Effect, Ref } from "effect";
import { expect, it } from "vitest";
import * as Process from "../src/Process";

// A managed process as a toolkit resource — driven through the same `yield* Tag` surface a
// remote consumer uses (only the provided layer differs). A base `Process.Tag` is armed and runs
// immediately (default always-armed); a `.pipe(Process.schedule([]))` tag owns an empty inline
// schedule (disarmed, and gains the `schedule` verb group) so `run` / schedule CRUD can
// be observed in isolation.
class ArmedProc extends Process.Tag<ArmedProc>()("test/process-contract/Armed") {}
class ScheduledProc extends Process.Tag<ScheduledProc>()(
  "test/process-contract/Scheduled",
).pipe(Process.schedule([])) {}

it("with the default schedule a process arms and runs its effect immediately", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const proc = yield* ArmedProc;
        // wait for the supervisor to arm + run the always-open window once
        yield* Effect.gen(function* () {
          while ((yield* Ref.get(ran)) < 1) yield* Effect.sleep(Duration.millis(5));
        }).pipe(Effect.timeout(Duration.seconds(1)));
        expect(yield* Ref.get(ran)).toBeGreaterThanOrEqual(1);
        expect((yield* proc.status.get).armed).toBe(true);
      }).pipe(
        Effect.provide(Process.layer(ArmedProc, { effect: Ref.update(ran, (n) => n + 1) })),
      );
    }),
  ));

it("effect runs the worker once (disarmed via an empty inline schedule)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const proc = yield* ScheduledProc;
        const before = yield* proc.status.get;
        expect(before.supervising).toBe(true);
        expect(before.armed).toBe(false);
        expect(before.activeInstances).toBe(0);

        yield* proc.run;
        expect(yield* Ref.get(ran)).toBe(1);

        // run metrics increment at the single run boundary
        const after = yield* proc.status.get;
        expect(after.runsStarted).toBe(1);
        expect(after.runsSucceeded).toBe(1);
        expect(after.runsFailed).toBe(0);
        expect(after.lastRunStartedAt).toBeDefined();
        expect(typeof after.lastRunDurationMillis).toBe("number");
      }).pipe(
        Effect.provide(
          Process.layer(ScheduledProc, { effect: Ref.update(ran, (n) => n + 1) }),
        ),
      );
    }),
  ));

it("schedule round-trips through set/add/clear and the reactive read", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* ScheduledProc;
      const future = DateTime.makeUnsafe(4_102_444_800_000); // 2100-01-01, fixed far-future

      yield* proc.schedule.set([{ id: "e1", startAt: future }]);
      let entries = yield* proc.schedule.entries.get;
      expect(entries.map((e) => e.id)).toEqual(["e1"]);

      yield* proc.schedule.add({ id: "e2", startAt: future });
      entries = yield* proc.schedule.entries.get;
      expect(entries.map((e) => e.id).sort()).toEqual(["e1", "e2"]);

      yield* proc.schedule.clear();
      entries = yield* proc.schedule.entries.get;
      expect(entries).toEqual([]);
    }).pipe(Effect.provide(Process.layer(ScheduledProc, { effect: Effect.void }))),
  ));

it("stop/start toggles supervision (observable via status.supervising)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* ArmedProc;
      expect((yield* proc.status.get).supervising).toBe(true);

      yield* proc.stop();
      expect((yield* proc.status.get).supervising).toBe(false);

      yield* proc.start();
      expect((yield* proc.status.get).supervising).toBe(true);
    }).pipe(Effect.provide(Process.layer(ArmedProc, { effect: Effect.void }))),
  ));
