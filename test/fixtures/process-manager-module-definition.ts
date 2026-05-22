import { Effect } from "effect";
import { Process, ProcessGroup, QueueResource } from "../../src";

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

