import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  splitting: true,
  sourcemap: true,
  treeshake: true,
  outDir: "dist",
  external: [
    "@prisma/client",
    "@effect/sql-sqlite-node",
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      Process: "src/Process.ts",
      QueueResource: "src/internal/queueResourceNamespace.ts",
      CustomQueueContract: "src/CustomQueueContract.ts",
      CustomQueueResource: "src/CustomQueueResource.ts",
      Resource: "src/Resource.ts",
      QueueContract: "src/QueueContract.ts",
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
      HostLogs: "src/HostLogs.ts",
      HostStatus: "src/HostStatus.ts",
      HistoryStore: "src/HistoryStore.ts",
      DurableQueueStore: "src/DurableQueueStore.ts",
      Group: "src/Group.ts",
      ScheduledProcess: "src/ScheduledProcess.ts",
      ProcessScheduleContract: "src/ProcessScheduleContract.ts",
      ApiMetrics: "src/ApiMetrics.ts",
      ApiUsageSchema: "src/ApiUsageSchema.ts",
      HttpApiResource: "src/HttpApiResource.ts",
      web: "src/web/index.ts",
      cli: "src/cli/index.ts",
      tui: "src/tui/index.ts",
      "storage/sqlite": "src/storage/sqlite/index.ts",
      "storage/redis": "src/storage/redis/index.ts",
      "storage/prisma": "src/storage/prisma.ts",
      "prisma/index": "src/prisma/index.ts",
    },
    dts: true,
    clean: true,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
