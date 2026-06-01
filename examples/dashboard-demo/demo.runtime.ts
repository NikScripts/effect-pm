/**
 * Node runtime: ControlService on 127.0.0.1:3001 for the dashboard demo UI.
 *
 * Run: `pnpm run example:dashboard-demo:pm`
 */

import { Effect, Layer, Schedule } from "effect";
import { ControlService, ProcessGroup, ProcessStorage } from "../../src";
import { layerProcessGroupLogContext } from "../../src/LogContext";
import { relayWithCaptureLoggerLayer } from "../../src/Logs";
import { DashboardDemoQueue, DashboardTick } from "./demo.tags";

const port = 3001;

const envLayer = Layer.mergeAll(
  DashboardTick.layer,
  DashboardDemoQueue.layer,
  ProcessStorage.layer,
  layerProcessGroupLogContext("dashboard-demo-group"),
  relayWithCaptureLoggerLayer,
);

const program = Effect.gen(function* () {
  const group = yield* ProcessGroup.make("dashboard-demo-group", [
    DashboardTick,
    DashboardDemoQueue,
  ] as const);

  yield* ControlService.make({ group, port });
  yield* Effect.logInfo(`ControlService listening on http://127.0.0.1:${String(port)}`);
  yield* Effect.logInfo("Start the UI: pnpm run example:dashboard-demo:ui");

  yield* group.start(DashboardTick);
  const queue = yield* DashboardDemoQueue;
  yield* queue.add(["hello-queue"]);
  yield* Effect.forkScoped(
    Effect.logInfo("dashboard demo heartbeat").pipe(
      Effect.repeat(Schedule.fixed("3 seconds")),
    ),
  );

  yield* group.awaitShutdown({
    logMessage: (signal) => `Received ${signal}, shutting down…`,
  });
});

void Effect.runPromise(
  Effect.scoped(program.pipe(Effect.provide(envLayer))),
);
