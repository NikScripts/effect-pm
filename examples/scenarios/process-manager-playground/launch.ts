/**
 * @module examples/scenarios/process-manager-playground/launch
 *
 * Shared `Endpoint.module` launch config for `group-start`.
 */

import { Endpoint, ProcessManager, type ProcessManagerModuleEndpointLaunchConfig } from "../../../src";

/** Launch config for `group-start`: spawns a child Node process running the runtime entry script. */
export const moduleLaunch = (
  runtimeEntry: string,
  controlBaseUrl: string,
): ProcessManagerModuleEndpointLaunchConfig => ({
  command: process.execPath,
  args: ["--import", "tsx", runtimeEntry],
  control: Endpoint.http({
    transport: ProcessManager.Transport.http({ baseUrl: controlBaseUrl }),
  }),
  logDirectory: ".effect-pm/logs",
  runDirectory: ".effect-pm/run/groups",
  pollInterval: "200 millis",
  startupTimeout: "15 seconds",
});
