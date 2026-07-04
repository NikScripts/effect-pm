import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  splitting: true,
  sourcemap: true,
  treeshake: true,
  outDir: "dist",
  external: [
    "@effect/sql-sqlite-node",
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      Process: "src/Process.ts",
      QueueResource: "src/QueueResource.ts",
      CustomQueueResource: "src/internal/customQueueResourceNamespace.ts",
      Resource: "src/Resource.ts",
      MultiNode: "src/MultiNode.ts",
      ProcessStore: "src/ProcessStore.ts",
      ProcessStorage: "src/ProcessStorage.ts",
      "store/QueueResource": "src/store/queueResource.ts",
      "store/Log": "src/store/log.ts",
      "store/RunResource": "src/store/runResource.ts",
      "store/ProcessLifecycle": "src/store/processLifecycle.ts",
      "store/ProcessExecution": "src/store/processExecution.ts",
      Query: "src/Query.ts",
      ResourceConfigure: "src/ResourceConfigure.ts",
      RuntimeStorage: "src/RuntimeStorage.ts",
      Logs: "src/Logs.ts",
      NodeLogs: "src/NodeLogs.ts",
      NodeStatus: "src/NodeStatus.ts",
      HistoryStore: "src/HistoryStore.ts",
      DurableQueueStore: "src/DurableQueueStore.ts",
      Group: "src/Group.ts",
      ScheduledProcess: "src/internal/scheduledProcessNamespace.ts",
      ApiMetrics: "src/ApiMetrics.ts",
      Telemetry: "src/Telemetry.ts",
      ApiUsageSchema: "src/ApiUsageSchema.ts",
      HttpApiResource: "src/HttpApiResource.ts",
      web: "src/web/index.ts",
      cli: "src/cli/index.ts",
      tui: "src/tui/index.ts",
      "storage/sqlite": "src/storage/sqlite/index.ts",
      "storage/redis": "src/storage/redis/index.ts",
    },
    dts: true,
    clean: true,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
