/**
 * @module examples/scenarios/schedule-sync-from-db
 *
 * DB rows → Daemon schedule entries, synced at startup and each tick. Run: `pnpm run example:scenario-schedule-sync-db`
 *
 * Docs: `docs/examples/scenarios/schedule-sync-from-db.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Daemon } from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

interface DbScheduleRow {
  readonly id: string;
  readonly startMs: number;
  readonly stopMs?: number;
}

const toEntry = (row: DbScheduleRow): Daemon.ScheduleEntry => ({
  id: Option.some(row.id),
  startAt: utcDateFromMillis(row.startMs),
  stopAt: row.stopMs === undefined ? Option.none() : Option.some(utcDateFromMillis(row.stopMs)),
});

const program = Effect.gen(function* () {
  const dbRows = yield* Ref.make<ReadonlyArray<DbScheduleRow>>([
    { id: "db-a", startMs: 0, stopMs: 700 },
    { id: "db-b", startMs: 1_400, stopMs: 2_200 },
  ]);
  const ticks = yield* Ref.make(0);

  const proc = Daemon.make("examples/schedule-db-sync", {
    polling: Polling.spaced(Duration.millis(100)),
    // Initial sync at process startup.
    schedule: ({ set }) =>
      Effect.gen(function* () {
        const rows = yield* Ref.get(dbRows);
        yield* set(rows.map(toEntry));
      }),
    // Ongoing sync while running (simulated polling strategy).
    effect: Effect.gen(function* () {
      const controls = yield* Daemon.scheduleControls;
      const rows = yield* Ref.get(dbRows);
      yield* controls.set(rows.map(toEntry));
      yield* Ref.update(ticks, (n) => n + 1);
    }),
  });

  const supervisor = yield* Effect.forkChild(proc.effect);

  // Simulate DB change: remove stale rows and introduce a new one.
  yield* Effect.sleep(Duration.millis(900));
  yield* Ref.set(dbRows, [
    { id: "db-c", startMs: 2_500, stopMs: 3_200 },
  ]);

  yield* TestClock.adjust(Duration.seconds(5));
  yield* Effect.yieldNow;
  yield* Effect.logInfo(`ticks with db-sync pattern: ${yield* Ref.get(ticks)}`);
  yield* Fiber.interrupt(supervisor);
}).pipe(Effect.scoped);

// ---cut-after---
runNodeProgramWithLayer(
  program,
  TestClock.layer(),
  "scenario:schedule-sync-from-db finished",
);
