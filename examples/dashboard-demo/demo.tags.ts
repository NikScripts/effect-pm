/**
 * Browser-safe tags for the dashboard demo (no layers, no ControlService).
 *
 * @module examples/dashboard-demo/demo.tags
 */

import { Duration, Effect } from "effect";
import {
  Process,
  ProcessGroup,
  Polling,
  ProcessSchedule,
} from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

/** Managed process polled every five seconds while armed. */
export class DashboardTick extends Process.Service<DashboardTick>()("dashboard-tick", {
  polling: Polling.spaced(Duration.seconds(5)),
  schedule: ProcessSchedule.inMemory([
    ProcessSchedule.at("dashboard-tick", utcDateFromMillis(0)),
  ]),
  effect: Effect.gen(function* () {
    yield* Effect.logInfo("dashboard tick");
  }),
}) {}

/** Typed group exposed through ControlService for the Vite operator panel. */
export class DashboardDemoGroup extends ProcessGroup.Service<DashboardDemoGroup>()(
  "dashboard-demo-group",
  [DashboardTick] as const,
) {}
