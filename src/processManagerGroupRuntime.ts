import { Layer, Scope } from "effect";
import { ControlService } from "./ControlService.js";
import { localEnvLayer } from "./ProcessGroup.js";
import type { ProcessGroupEntry, ProcessGroupServiceDefinition } from "./ProcessGroup.js";
import type { ProcessStore } from "./ProcessStore.js";
import { parsePortFromTransport } from "./processManagerTransport.js";
import type { ProcessManagerTransport } from "./processManagerTransport.js";

/**
 * Build a local runtime descriptor for a group child process.
 *
 * @public
 */
export const groupLocalRuntime = <
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries>,
  options: {
    readonly controlBaseUrl: string;
    readonly store?: Layer.Layer<ProcessStore, never, Scope.Scope>;
  },
) => {
  const transport: ProcessManagerTransport = {
    _tag: "ProcessManagerHttpTransport",
    baseUrl: options.controlBaseUrl,
  };
  const port = parsePortFromTransport(transport);
  const layer = localEnvLayer(
    group,
    options.store === undefined ? {} : { store: options.store },
  );
  const control = ControlService.layerHttp(group, { port });
  return {
    _tag: "ProcessManagerLocalRuntime" as const,
    group,
    layer,
    control,
  };
};
