/**
 * Browser-safe tags for the dashboard demo (no layers, no ControlService).
 *
 * @module examples/dashboard-demo/demo.tags
 */

import { Duration, Effect } from "effect";
import { Polling } from "../../src/Polling";
import { Process } from "../../src/Process";
import { ProcessGroup } from "../../src/ProcessGroup";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { QueueResource } from "../../src/QueueResource";

/** Managed process polled every five seconds while armed. */
export class DashboardTick extends Process.Service<DashboardTick>()("dashboard-tick", {
  polling: Polling.spaced(Duration.seconds(5)),
  schedule: ProcessSchedule.inMemory([
    ProcessSchedule.at("dashboard-tick", new Date(0)),
  ]),
  effect: Effect.gen(function* () {
    yield* Effect.logInfo("dashboard tick");
  }),
}) {}

export class DashboardDemoQueue extends QueueResource.Service<DashboardDemoQueue, string, never>()(
  "dashboard-demo-queue",
  {
    effect: (item: string) => Effect.logInfo(`queue item: ${item}`),
    concurrency: 1,
    paused: true,
  },
) {}

/** Typed group exposed through ControlService for the Vite operator panel. */
export class DashboardDemoGroup extends ProcessGroup.Service<DashboardDemoGroup>()(
  "dashboard-demo-group",
  [DashboardTick, DashboardDemoQueue] as const,
) {}
