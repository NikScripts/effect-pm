import { DateTime, Duration, Effect, Option, Ref, Schema } from "effect";
import { expect, it } from "vitest";
import * as Daemon from "../src/Daemon";

// The revamped `Daemon` toolkit: one namespace whose light contract (`Tag` / `Schedule` / `schedule`
// / `result`) is shaped by pipeable combinators and driven by the heavy layers (`layer` / `serve`).
// Exercised through the same `yield* Tag` surface a remote consumer uses — only the layer differs.

// 2100-01-01, fixed far-future so scheduled windows never arm during the test.
const farFuture = DateTime.makeUnsafe(4_102_444_800_000);

// base — observation + lifecycle only; always-armed by default so it runs immediately.
class BaseDaemon extends Daemon.Service<BaseDaemon>()("test/toolkit/Base") {}

// owns an inline schedule seeded empty (disarmed) — gains the `schedule` verb group.
class SchedDaemon extends Daemon.Service<SchedDaemon>()("test/toolkit/Sched").pipe(
  Daemon.schedule([]),
) {}

// value-returning + disarmed inline schedule, so `result` is observable before/after a manual run.
const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
class Priced extends Daemon.Service<Priced>()("test/toolkit/Priced", { success: Price }).pipe(
  Daemon.schedule([]),
) {}

// standalone reusable window manager.
class Windows extends Daemon.Schedule<Windows>()("test/toolkit/Windows") {}

it("base daemon arms and runs its effect immediately (default schedule)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ran = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const daemon = yield* BaseDaemon;
        yield* Effect.gen(function* () {
          while ((yield* Ref.get(ran)) < 1) yield* Effect.sleep(Duration.millis(5));
        }).pipe(Effect.timeout(Duration.seconds(1)));
        expect(yield* Ref.get(ran)).toBeGreaterThanOrEqual(1);
        expect((yield* daemon.status.get).armed).toBe(true);
      }).pipe(
        Effect.provide(Daemon.layerMemory(BaseDaemon, { effect: Ref.update(ran, (n) => n + 1) })),
      );
    }),
  ));

it("stop/start toggles supervision (observable via status.supervising)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* BaseDaemon;
      expect((yield* daemon.status.get).supervising).toBe(true);

      yield* daemon.stop;
      expect((yield* daemon.status.get).supervising).toBe(false);

      yield* daemon.start;
      expect((yield* daemon.status.get).supervising).toBe(true);
    }).pipe(Effect.provide(Daemon.layerMemory(BaseDaemon, { effect: Effect.void }))),
  ));

it("inline schedule verb group round-trips through set/add/clear and the entries ref", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* SchedDaemon;
      // seeded empty ⇒ disarmed, no entries
      expect((yield* daemon.status.get).armed).toBe(false);
      expect(yield* daemon.schedule.entries.get).toEqual([]);

      yield* daemon.schedule.set([{ id: "e1", startAt: farFuture }]);
      expect((yield* daemon.schedule.entries.get).map((e) => e.id)).toEqual(["e1"]);

      yield* daemon.schedule.add({ id: "e2", startAt: farFuture });
      expect((yield* daemon.schedule.entries.get).map((e) => e.id).sort()).toEqual([
        "e1",
        "e2",
      ]);

      yield* daemon.schedule.clear;
      expect(yield* daemon.schedule.entries.get).toEqual([]);
    }).pipe(Effect.provide(Daemon.layerMemory(SchedDaemon, { effect: Effect.void }))),
  ));

it("result captures the latest success (absent before the first run)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* Priced;
      // disarmed inline schedule ⇒ nothing has run yet ⇒ result is absent
      expect(Option.isNone(yield* daemon.result.get)).toBe(true);

      yield* daemon.run;

      const latest = yield* daemon.result.get;
      expect(Option.isSome(latest)).toBe(true);
      if (Option.isSome(latest)) {
        expect(latest.value).toEqual({ symbol: "AAPL", usd: 42 });
      }
    }).pipe(
      Effect.provide(
        Daemon.layerMemory(Priced, {
          effect: Effect.succeed({ symbol: "AAPL", usd: 42 }),
        }),
      ),
    ),
  ));

it("standalone Schedule resource supports full CRUD", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* Windows;
      expect(yield* s.entries.get).toEqual([]);

      yield* s.add({ id: "a", startAt: farFuture });
      expect(yield* s.has({ id: "a" })).toBe(true);
      expect(Option.isSome(yield* s.get({ id: "a" }))).toBe(true);

      yield* s.set([
        { id: "b", startAt: farFuture },
        { id: "c", startAt: farFuture },
      ]);
      expect((yield* s.entries.get).map((e) => e.id).sort()).toEqual(["b", "c"]);

      expect(yield* s.remove({ id: "b" })).toBe(true);
      expect((yield* s.entries.get).map((e) => e.id)).toEqual(["c"]);

      yield* s.clear;
      expect(yield* s.entries.get).toEqual([]);
    }).pipe(Effect.provide(Daemon.scheduleLayer(Windows))),
  ));
