/**
 * @module examples/logs/live-bus
 *
 * `Logs.layer` installs the live capture bus. `Logs.stream` tails it (snapshot first, then live
 * fan-out), and `Logs.snapshot` reads the bounded in-memory tail without opening a stream.
 * Run: `pnpm run example:logs-live-bus`
 *
 * Docs: `docs/examples/logs/live-bus.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Stream } from "effect";
import * as Logs from "../../src/Logs";

const waitForSnapshotLine = (message: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 20; i++) {
      const snapshot = yield* Logs.snapshot;
      if (snapshot.some((row) => row.message === message)) return snapshot;
      yield* Effect.sleep(Duration.millis(10));
    }
    return yield* Effect.die(`timed out waiting for snapshot line: ${message}`);
  });

const program = Effect.gen(function* () {
  const live = yield* Effect.forkChild(
    Logs.stream.pipe(
      Stream.filter((entry) => entry.message === "live bus: hello"),
      Stream.take(1),
      Stream.runCollect,
    ),
  );

  yield* Effect.logInfo("live bus: hello");

  const [entry] = Array.from(yield* Fiber.join(live));
  const snapshot = yield* waitForSnapshotLine("live bus: hello");

  yield* Effect.logInfo(`stream saw: ${entry?.message ?? "<missing>"}`);
  yield* Effect.logInfo(
    `snapshot contains live line: ${String(
      snapshot.some((row) => row.message === "live bus: hello"),
    )}`,
  );
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(Logs.layer),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "logs live-bus example finished");
