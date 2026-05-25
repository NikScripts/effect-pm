import { Layer, Scope } from "effect";
import { ControlService } from "../../ControlService";
import { localEnvLayer } from "../../ProcessGroup";
import type { ProcessGroupEntry, ProcessGroupServiceDefinition } from "../../ProcessGroup";
import type { ProcessStorage } from "../../ProcessStorage";
import { parsePortFromTransport } from "../../Transport";
import type { ProcessManagerTransport } from "../../Transport";

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
    readonly store?: Layer.Layer<ProcessStorage.Services, never, Scope.Scope>;
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
