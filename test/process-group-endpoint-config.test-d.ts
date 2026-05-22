import { Effect } from "effect";
import { Endpoint, Process, ProcessGroup, ProcessManager, Transport } from "../src";

class DemoProcess extends Process.Service<DemoProcess>()("@test/EndpointConfigDemoProcess", {
  effect: Effect.void,
}) {}

const workshop = Transport.http(32201);

export class WorkshopGroup extends ProcessGroup.Service<WorkshopGroup>()(
  "@test/EndpointConfigWorkshopGroup",
  [DemoProcess] as const,
  [
    Endpoint.local(workshop, "file:///test/endpoint-config-workshop-group.ts").default,
    Endpoint.production(workshop),
    Endpoint.define("preview", Transport.http("workshop.preview.internal", 443)),
  ],
) {}

void ProcessManager.GroupConfig(WorkshopGroup);
