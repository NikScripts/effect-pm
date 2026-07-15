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
      CustomQueueResource: "src/CustomQueueResource.ts",
      Resource: "src/Resource.ts",
      MultiNode: "src/MultiNode.ts",
      ResourceConfigure: "src/ResourceConfigure.ts",
      Logs: "src/Logs.ts",
      NodeStatus: "src/NodeStatus.ts",
      HistoryStore: "src/HistoryStore.ts",
      DurableQueueStore: "src/DurableQueueStore.ts",
      Group: "src/Group.ts",
      Store: "src/Store.ts",
      ApiMetrics: "src/ApiMetrics.ts",
      Telemetry: "src/Telemetry.ts",
      FleetHealth: "src/FleetHealth.ts",
      ShardMap: "src/ShardMap.ts",
      DynamicConfig: "src/DynamicConfig.ts",
      ApiUsageSchema: "src/ApiUsageSchema.ts",
      HttpApiResource: "src/HttpApiResource.ts",
      web: "src/web/index.ts",
      cli: "src/cli/index.ts",
      tui: "src/tui/index.ts",
      "storage/sqlite": "src/storage/sqlite/index.ts",
    },
    dts: true,
    clean: true,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
