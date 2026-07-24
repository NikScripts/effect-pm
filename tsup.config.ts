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
      Daemon: "src/Daemon.ts",
      Polling: "src/Polling.ts",
      WorkPool: "src/WorkPool.ts",
      Hyperlink: "src/Hyperlink.ts",
      Node: "src/Node.ts",
      MultiNode: "src/MultiNode.ts",
      HyperlinkConfigure: "src/HyperlinkConfigure.ts",
      Logs: "src/Logs.ts",
      LogEntry: "src/LogEntry.ts",
      LogContext: "src/LogContext.ts",
      HistoryStore: "src/HistoryStore.ts",
      DurableQueueStore: "src/DurableQueueStore.ts",
      Group: "src/Group.ts",
      Store: "src/Store.ts",
      ApiMetrics: "src/ApiMetrics.ts",
      Telemetry: "src/Telemetry.ts",
      FleetHealth: "src/FleetHealth.ts",
      ShardMap: "src/ShardMap.ts",
      Lookup: "src/Lookup.ts",
      DynamicConfig: "src/DynamicConfig.ts",
      ApiUsageSchema: "src/ApiUsageSchema.ts",
      Gate: "src/Gate.ts",
      HttpClientGate: "src/HttpClientGate.ts",
      cli: "src/cli/index.ts",
      "storage/sqlite": "src/storage/sqlite/index.ts",
    },
    dts: true,
    clean: true,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    // The `web` (browser/React) and `tui` (Ink/React) entries build declarations under their
    // relaxed UI rulesets — the root config's Effect-purity plugin (globalDate / globalTimers /
    // globalConsole / asyncFunction) is wrong for UI code and would fail the DTS build. `clean`
    // stays off so later entries don't wipe earlier output.
    ...shared,
    entry: {
      web: "src/web/index.ts",
    },
    tsconfig: "src/web/tsconfig.json",
    dts: true,
    clean: false,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    ...shared,
    entry: {
      tui: "src/tui/index.ts",
    },
    tsconfig: "src/tui/tsconfig.json",
    dts: true,
    clean: false,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
