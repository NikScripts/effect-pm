/**
 * @module examples/schedule-control-db-sync
 *
 * Simulated DB-to-runtime schedule sync pattern.
 *
 * This example shows how to:
 * - load schedule rows from a "DB" source
 * - convert rows to ProcessSchedule entries
 * - keep runtime schedule in sync using `set(...)`
 * - perform sync from both initializer and running process effect
 *
 * Run:
 * - `pnpm run example:schedule-control-db-sync`
 * - `npx tsx examples/schedule-control-db-sync.ts`
 */

import { Duration, Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessStore } from "../src";
import type { ProcessScheduleEntry } from "../src/ProcessSchedule";
import { runNodeProgramOrExit } from "./mocks/demo-harness.mock.js";

interface DbScheduleRow {
  readonly id: string;
  readonly startMs: number;
  readonly stopMs?: number;
}

const toEntry = (row: DbScheduleRow): ProcessScheduleEntry => ({
  id: Option.some(row.id),
  startAt: new Date(row.startMs),
  stopAt: row.stopMs === undefined ? Option.none() : Option.some(new Date(row.stopMs)),
});

const program = Effect.gen(function* () {
  const dbRows = yield* Ref.make<ReadonlyArray<DbScheduleRow>>([
    { id: "db-a", startMs: 0, stopMs: 700 },
    { id: "db-b", startMs: 1_400, stopMs: 2_200 },
  ]);
  const ticks = yield* Ref.make(0);

  const proc = Process.make({
    name: "examples/schedule-db-sync",
    polling: Polling.spaced(Duration.millis(100)),
    // Initial sync at process startup.
    schedule: ({ set }) =>
      Effect.gen(function* () {
        const rows = yield* Ref.get(dbRows);
        yield* set(rows.map(toEntry));
      }),
    // Ongoing sync while running (simulated polling strategy).
    effect: Effect.gen(function* () {
      const controls = yield* Process.scheduleControls;
      const rows = yield* Ref.get(dbRows);
      yield* controls.set(rows.map(toEntry));
      yield* Ref.update(ticks, (n) => n + 1);
    }),
  });

  const supervisor = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(ProcessStore.layer)));

  // Simulate DB change: remove old rows and introduce a new one.
  yield* Effect.sleep(Duration.millis(900));
  yield* Ref.set(dbRows, [
    { id: "db-c", startMs: 2_500, stopMs: 3_200 },
  ]);

  yield* TestClock.adjust(Duration.seconds(5));
  yield* Effect.yieldNow;
  yield* Effect.logInfo(`ticks with db-sync pattern: ${yield* Ref.get(ticks)}`);
  yield* Fiber.interrupt(supervisor);
}).pipe(
  Effect.provide(TestClock.layer()),
  Effect.scoped,
);

runNodeProgramOrExit(program, "✅ schedule-control-db-sync.ts finished");
