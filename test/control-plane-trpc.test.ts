import { describe, expect, it } from "vitest";
import { createTrpcControlPlaneAdapter } from "../src/react/adapters/trpc.js";

describe("createTrpcControlPlaneAdapter", () => {
  it("delegates to duck-typed client procedures", async () => {
    const calls: string[] = [];
    const port = createTrpcControlPlaneAdapter({
      contract: {
        query: async () => {
          calls.push("contract");
          return {
            id: "@test/TrpcGroup",
            kind: "group",
            version: "v1",
            processes: [],
            queues: [],
          };
        },
      },
      status: {
        query: async () => {
          calls.push("status");
          return {
            processes: [
              {
                name: "p1",
                type: "process",
                status: "running",
                uptime: 1,
                startTime: null,
                lastRun: null,
                executions: 0,
                firstStartup: null,
                armed: true,
                nextScheduleTransition: null,
                nextPollCadence: null,
                activeInstances: 1,
                nextTriggerRun: null,
              },
            ],
            queues: [
              {
                name: "q1",
                size: { high: 0, normal: 1, low: 0, total: 1 },
                completed: 2,
              },
            ],
          };
        },
      },
      processAction: {
        mutate: async (input) => {
          calls.push(`process:${input.id}:${input.action}`);
          return { success: true };
        },
      },
      queueAction: {
        mutate: async (input) => {
          calls.push(`queue:${input.id}:${input.action}`);
          return { success: true };
        },
      },
    });

    const contract = await port.getContract();
    expect(contract.id).toBe("@test/TrpcGroup");

    const status = await port.getStatus();
    expect(status.queues[0]?.name).toBe("q1");

    const process = await port.getProcess("p1");
    expect(process.success).toBe(true);

    await port.postQueueAction("q1", "pause");
    expect(calls).toContain("queue:q1:pause");
  });
});
