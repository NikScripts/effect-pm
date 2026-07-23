import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import * as Logs from "../src/Logs";
import * as Daemon from "../src/Daemon";
import * as Hyperlink from "../src/Hyperlink";
import * as Store from "../src/Store";

// A process started disarmed (empty inline schedule) so it only runs on `run`; with the logs
// stack provided, worker lines are scoped by tag key and read back via Hyperlink.logs.
class LogProc extends Daemon.Tag<LogProc>()(
  "test/process-log-history/Proc",
).pipe(Daemon.schedule([])) {}

const logProcRegistration = Daemon.store(LogProc);

class AppStore extends Store.Service<AppStore>("@test/process-log-history/Store")(
  logProcRegistration,
) {}

it("Hyperlink.logs reads back process worker logs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      const { query } = yield* Hyperlink.logs(LogProc);
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
        Daemon.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
        }).pipe(Layer.provideMerge(AppStore.layerMemory)),
      ),
      Effect.scoped,
    ),
  ));

it("Hyperlink.logs query is empty without store registration (live relay only)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      const { query } = yield* Hyperlink.logs(LogProc);
      expect(yield* query({})).toEqual([]);
      yield* proc.run;
      yield* Effect.sleep(Duration.millis(50));
      expect(yield* query({})).toEqual([]);
    }).pipe(
      Effect.provide(
        Daemon.layerMemory(LogProc, {
          effect: Effect.logInfo("process tick"),
        }).pipe(Layer.provide(Logs.layer)),
      ),
      Effect.scoped,
    ),
  ));
