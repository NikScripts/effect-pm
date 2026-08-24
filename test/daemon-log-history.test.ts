import { Duration, Effect, Layer } from "effect";
import { expect, it } from "vitest";
import * as Logs from "../src/Logs";
import * as Daemon from "../src/Daemon";
import * as Hyperlink from "../src/Hyperlink";
import * as Store from "../src/Store";

// A daemon started disarmed (empty inline schedule) so it only runs on `run`; with the logs
// stack provided, worker lines are scoped by tag key and read back via Hyperlink.logs.
class LogDaemon extends Daemon.Service<LogDaemon>()(
  "test/daemon-log-history/Daemon",
).pipe(Daemon.schedule([])) {}

const logDaemonRegistration = Daemon.store(LogDaemon);

class AppStore extends Store.Service<AppStore>("@test/daemon-log-history/Store")(
  logDaemonRegistration,
) {}

it("Hyperlink.logs reads back daemon worker logs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* LogDaemon;
      const { query } = yield* Hyperlink.logs(LogDaemon);
      yield* daemon.run;
      yield* Effect.gen(function* () {
        while ((yield* query({})).length === 0) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const rows = yield* query({ limit: 50 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.message.includes("daemon tick"))).toBe(true);
    }).pipe(
      Effect.provide(
        Daemon.layer(LogDaemon, {
          effect: Effect.logInfo("daemon tick"),
        }).pipe(Layer.provideMerge(AppStore.layerMemory)),
      ),
      Effect.scoped,
    ),
  ));

it("Hyperlink.logs query is empty without store registration (live relay only)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* LogDaemon;
      const { query } = yield* Hyperlink.logs(LogDaemon);
      expect(yield* query({})).toEqual([]);
      yield* daemon.run;
      yield* Effect.sleep(Duration.millis(50));
      expect(yield* query({})).toEqual([]);
    }).pipe(
      Effect.provide(
        Daemon.layerMemory(LogDaemon, {
          effect: Effect.logInfo("daemon tick"),
        }).pipe(Layer.provide(Logs.layer)),
      ),
      Effect.scoped,
    ),
  ));
