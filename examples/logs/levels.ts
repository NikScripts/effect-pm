/**
 * @module examples/logs/levels
 *
 * Log levels have two knobs: `Hyperlink.logStreamLevel*` / `Store.streamLevel*` gate the live
 * `Hyperlink.logs(tag).stream`, while `Store.logLevel*` gates what the durable `_logs` tail keeps.
 * Run: `pnpm run example:logs-levels`
 *
 * Docs: `docs/examples/logs/levels.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Stream } from "effect";
import * as Daemon from "../../src/Daemon";
import * as Hyperlink from "../../src/Hyperlink";
import * as Logs from "../../src/Logs";
import * as Store from "../../src/Store";

class LiveWarnOnly extends Daemon.Tag<LiveWarnOnly>()("examples/logs/LiveWarnOnly").pipe(
  Hyperlink.logStreamLevelWarn,
) {}

class DurableWarnOnly extends Daemon.Tag<DurableWarnOnly>()("examples/logs/DurableWarnOnly") {}

class AppStore extends Store.Service<AppStore>("@examples/logs/LevelsStore")(
  // Durable level defaults to All; only the live stream is Warn+.
  Daemon.store(LiveWarnOnly),
  // Durable tail is Warn+; the live stream stays All.
  Daemon.store(DurableWarnOnly).pipe(Store.logLevelWarn),
) {}

const waitForDurableRows = (
  query: () => Effect.Effect<ReadonlyArray<{ readonly message: string }>>,
) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50; i++) {
      const rows = yield* query();
      if (rows.length > 0) return rows;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die("timed out waiting for durable log rows");
  });

const program = Effect.gen(function* () {
  const liveWarnLogs = yield* Hyperlink.logs(LiveWarnOnly);
  const durableWarnLogs = yield* Hyperlink.logs(DurableWarnOnly);

  const liveWarnStream = yield* Effect.forkChild(
    liveWarnLogs.stream.pipe(
      Stream.filter((entry) => entry.message.startsWith("live-level")),
      Stream.take(1),
      Stream.runCollect,
    ),
  );
  const durableWarnStream = yield* Effect.forkChild(
    durableWarnLogs.stream.pipe(
      Stream.filter((entry) => entry.message.startsWith("durable-level")),
      Stream.take(1),
      Stream.runCollect,
    ),
  );

  yield* Effect.yieldNow;
  yield* Effect.logInfo("live-level info").pipe(Logs.withScope(LiveWarnOnly));
  yield* Effect.logWarning("live-level warn").pipe(Logs.withScope(LiveWarnOnly));
  yield* Effect.logInfo("durable-level info").pipe(Logs.withScope(DurableWarnOnly));
  yield* Effect.logWarning("durable-level warn").pipe(Logs.withScope(DurableWarnOnly));

  const [liveFirst] = Array.from(yield* Fiber.join(liveWarnStream));
  const [durableFirst] = Array.from(yield* Fiber.join(durableWarnStream));

  const liveDurable = yield* waitForDurableRows(() => liveWarnLogs.query({ limit: 20 }));
  const durableDurable = yield* waitForDurableRows(() => durableWarnLogs.query({ limit: 20 }));

  yield* Effect.logInfo(`live stream floor kept: ${liveFirst?.message ?? "<missing>"}`);
  yield* Effect.logInfo(`durable stream default kept: ${durableFirst?.message ?? "<missing>"}`);
  yield* Effect.logInfo(
    `live tag durable messages: ${liveDurable.map((row) => row.message).join(", ")}`,
  );
  yield* Effect.logInfo(
    `durable Warn tail messages: ${durableDurable.map((row) => row.message).join(", ")}`,
  );
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(AppStore.layerMemory),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "logs levels example finished");
