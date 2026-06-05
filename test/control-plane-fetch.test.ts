import { describe, expect, it, vi } from "vitest";
import { createFetchControlPlaneAdapter } from "../src/react/adapters/fetch.js";

const contractBody = {
  id: "@test/DashboardGroup",
  kind: "group",
  version: "v1",
  processes: [{
    id: "tick",
    kind: "process",
    controls: ["start", "stop", "restart", "runImmediately", "status"],
  }],
  queues: [],
} as const;

const statusBody = {
  success: true,
  data: {
    processes: [
      {
        name: "tick",
        type: "process",
        status: "running",
        uptime: 1200,
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
    queues: [],
  },
};

describe("createFetchControlPlaneAdapter", () => {
  it("maps REST paths under baseUrl", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/contract") && method === "GET") {
        return new Response(JSON.stringify(contractBody), { status: 200 });
      }
      if (url.endsWith("/status") && method === "GET") {
        return new Response(JSON.stringify(statusBody), { status: 200 });
      }
      if (url.includes("/processes/tick/stop") && method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, error: "unexpected" }), {
        status: 404,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const port = createFetchControlPlaneAdapter({
      baseUrl: "/api/control",
      defaultInit: { credentials: "same-origin" },
      mergeRequestInit: (init) => ({ ...init, headers: { "X-Test": "1", ...init.headers } }),
    });

    const contract = await port.getContract();
    expect(contract.id).toBe("@test/DashboardGroup");

    const status = await port.getStatus();
    expect(status.processes).toHaveLength(1);
    expect(status.processes[0]?.name).toBe("tick");

    await port.postProcessAction("tick", "stop");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/processes/tick/stop",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );

    vi.unstubAllGlobals();
  });
});
