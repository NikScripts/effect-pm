import { DateTime, Duration, Effect, Ref } from "effect";
import { expect, it } from "vitest";
import * as Daemon from "../src/Daemon";

// A managed daemon as a toolkit resource — driven through the same `yield* Tag` surface a
// remote consumer uses (only the provided layer differs). A base `Daemon.Tag` is armed and runs
// immediately (default always-armed); a `.pipe(Daemon.schedule([]))` tag owns an empty inline
// schedule (disarmed, and gains the `schedule` verb group) so `run` / schedule CRUD can
// be observed in isolation.
class ArmedDaemon extends Daemon.Tag<ArmedDaemon>()("test/daemon-contract/Armed") {}
class ScheduledDaemon extends Daemon.Tag<ScheduledDaemon>()(
  "test/daemon-contract/Scheduled",
).pipe(Daemon.schedule([])) {}

it("with the default schedule a daemon arms and runs its effect immediately", () =>
  Effect.runPromise(
    (Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const daemon = yield* ArmedDaemon;
        // wait for the supervisor to arm + run the always-open window once
        yield* Effect.gen(function* () {
          while ((yield* Ref.get(ran)) < 1) yield* Effect.sleep(Duration.millis(5));
        }).pipe(Effect.timeout(Duration.seconds(1)));
        expect(yield* Ref.get(ran)).toBeGreaterThanOrEqual(1);
        expect((yield* daemon.status.get).armed).toBe(true);
      }).pipe(
        Effect.provide(Daemon.layerMemory(ArmedDaemon, { effect: Ref.update(ran, (n) => n + 1) })),
      );
    }) as any),
  ));

it("effect runs the worker once (disarmed via an empty inline schedule)", () =>
  Effect.runPromise(
    (Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const daemon = yield* ScheduledDaemon;
        const before = yield* daemon.status.get;
        expect(before.supervising).toBe(true);
        expect(before.armed).toBe(false);
        expect(before.activeInstances).toBe(0);

        yield* daemon.run;
        expect(yield* Ref.get(ran)).toBe(1);

        // run metrics increment at the single run boundary
        const after = yield* daemon.status.get;
        expect(after.runsStarted).toBe(1);
        expect(after.runsSucceeded).toBe(1);
        expect(after.runsFailed).toBe(0);
        expect(after.lastRunStartedAt).toBeDefined();
        expect(typeof after.lastRunDurationMillis).toBe("number");
      }).pipe(
        Effect.provide(
          Daemon.layerMemory(ScheduledDaemon, { effect: Ref.update(ran, (n) => n + 1) }),
        ),
      );
    }) as any),
  ));

it("schedule round-trips through set/add/clear and the reactive read", () =>
  Effect.runPromise(
    (Effect.gen(function* () {
      const daemon = yield* ScheduledDaemon;
      const future = DateTime.makeUnsafe(4_102_444_800_000); // 2100-01-01, fixed far-future

      yield* daemon.schedule.set([{ id: "e1", startAt: future }]);
      let entries = yield* daemon.schedule.entries.get;
      expect(entries.map((e) => e.id)).toEqual(["e1"]);

      yield* daemon.schedule.add({ id: "e2", startAt: future });
      entries = yield* daemon.schedule.entries.get;
      expect(entries.map((e) => e.id).sort()).toEqual(["e1", "e2"]);

      yield* daemon.schedule.clear;
      entries = yield* daemon.schedule.entries.get;
      expect(entries).toEqual([]);
    }).pipe(Effect.provide(Daemon.layerMemory(ScheduledDaemon, { effect: Effect.void }))) as any),
  ));

it("stop/start toggles supervision (observable via status.supervising)", () =>
  Effect.runPromise(
    (Effect.gen(function* () {
      const daemon = yield* ArmedDaemon;
      expect((yield* daemon.status.get).supervising).toBe(true);

      yield* daemon.stop;
      expect((yield* daemon.status.get).supervising).toBe(false);

      yield* daemon.start;
      expect((yield* daemon.status.get).supervising).toBe(true);
    }).pipe(Effect.provide(Daemon.layerMemory(ArmedDaemon, { effect: Effect.void }))) as any),
  ));
