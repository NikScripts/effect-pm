import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { HistoryStore } from "../src";
import * as Process from "../src/Process";

// A process started disarmed (an empty inline schedule) so it only runs on run; with
// captureLogs + a HistoryStore, its logged line is captured, persisted, and read via logs.history.
class LogProc extends Process.Tag<LogProc>()(
  "test/process-log-history/Proc",
).pipe(Process.schedule([])) {}

it("process logs.history reads back captured logs (captureLogs + HistoryStore)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      yield* proc.run();
      // capture + append are async — wait until history is populated
      yield* Effect.gen(function* () {
        while ((yield* proc.logs.history({})).length === 0) {
          yield* Effect.sleep(Duration.millis(10));
        }
      }).pipe(Effect.timeout(Duration.seconds(2)));

      const rows = yield* proc.logs.history({ limit: 50 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => JSON.stringify(r).includes("process tick"))).toBe(
        true,
      );
    }).pipe(
      Effect.provide(
        Process.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
          captureLogs: true,
        }).pipe(Layer.provide(HistoryStore.layerMemory())),
      ),
      Effect.scoped,
    ),
  ));

it("process logs.history is empty without a HistoryStore (graceful, opt-in)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      yield* proc.run();
      yield* Effect.sleep(Duration.millis(50));
      expect(yield* proc.logs.history({})).toEqual([]);
    }).pipe(
      Effect.provide(
        Process.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
          captureLogs: true,
        }),
      ),
      Effect.scoped,
    ),
  ));
