import { Layer, Effect } from "effect";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "../../src";

interface ModuleEmail {
  readonly to: string;
}

class ModuleEndpointQueue extends QueueResource.Service<ModuleEndpointQueue, ModuleEmail, never>()(
  "@test/ModuleEndpointQueue",
  {
    effect: (_email) => Effect.void,
  },
) {}

class ModuleEndpointProcess extends Process.Service<ModuleEndpointProcess>()(
  "@test/ModuleEndpointProcess",
  {
    effect: Effect.void,
  },
) {}

export class ModuleEndpointGroup extends ProcessGroup.Service<ModuleEndpointGroup>()(
  "@test/ModuleEndpointGroup",
  [ModuleEndpointProcess, ModuleEndpointQueue] as const,
) {}

export const ModuleEndpointRuntime = ProcessManager.LocalRuntime(ModuleEndpointGroup, {
  layer: Layer.mergeAll(
    ModuleEndpointGroup.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ModuleEndpointProcess.layer,
          ModuleEndpointQueue.layer,
          ProcessStore.layer,
        ),
      ),
    ),
    ProcessStore.layer,
  ),
  control: ControlService.layerHttp(ModuleEndpointGroup, { port: 32146 }),
});
