import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import { LogStore } from "../src/store/log";
import { testLogsEnv } from "./fixtures/logsEnv";

// A process started disarmed (empty inline schedule) so it only runs on `run`; with the logs
// stack provided, worker lines are scoped by tag key and read back via Resource.logs.
class LogProc extends Process.Tag<LogProc>()(
  "test/process-log-history/Proc",
).pipe(Process.schedule([])) {}

it("Resource.logs reads back process worker logs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      const { query } = yield* Resource.logs(LogProc);
      yield* proc.run;
      yield* Effect.gen(function* () {
        while ((yield* query({})).length === 0) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const rows = yield* query({ limit: 50 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.message.includes("process tick"))).toBe(true);
    }).pipe(
      Effect.provide(
        Process.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
        }).pipe(Layer.provideMerge(testLogsEnv())),
      ),
      Effect.scoped,
    ),
  ));

it("Resource.logs query is empty without persistLayer (live relay only)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      const { query } = yield* Resource.logs(LogProc);
      expect(yield* query({})).toEqual([]);
      yield* proc.run;
      yield* Effect.sleep(Duration.millis(50));
      expect(yield* query({})).toEqual([]);
    }).pipe(
      Effect.provide(
        Process.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
        }).pipe(Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory))),
      ),
      Effect.scoped,
    ),
  ));
