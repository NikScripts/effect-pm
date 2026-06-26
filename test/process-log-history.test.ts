import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { HistoryStore, ScheduledProcess } from "../src";
import { ProcessSchedule } from "../src/ProcessSchedule";

// A process started disarmed (ProcessSchedule.empty) so it only runs on runImmediately; with
// captureLogs + a HistoryStore, its logged line is captured, persisted, and read via logHistory.
class LogProc extends ScheduledProcess.Tag<LogProc>()(
  "test/process-log-history/Proc",
) {}

it("process logHistory reads back captured logs (captureLogs + HistoryStore)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      yield* proc.runImmediately;
      // capture + append are async — wait until history is populated
      yield* Effect.gen(function* () {
        while ((yield* proc.logHistory({})).length === 0) {
          yield* Effect.sleep(Duration.millis(10));
        }
      }).pipe(Effect.timeout(Duration.seconds(2)));

      const rows = yield* proc.logHistory({ limit: 50 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => JSON.stringify(r).includes("process tick"))).toBe(
        true,
      );
    }).pipe(
      Effect.provide(
        ScheduledProcess.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
          schedule: ProcessSchedule.empty,
          captureLogs: true,
        }).pipe(Layer.provide(HistoryStore.layerMemory())),
      ),
      Effect.scoped,
    ),
  ));

it("process logHistory is empty without a HistoryStore (graceful, opt-in)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      yield* proc.runImmediately;
      yield* Effect.sleep(Duration.millis(50));
      expect(yield* proc.logHistory({})).toEqual([]);
    }).pipe(
      Effect.provide(
        ScheduledProcess.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
          schedule: ProcessSchedule.empty,
          captureLogs: true,
        }),
      ),
      Effect.scoped,
    ),
  ));
