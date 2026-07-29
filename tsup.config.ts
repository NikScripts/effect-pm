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
      Launcher: "src/Launcher.ts",
      MultiNode: "src/MultiNode.ts",
      HyperlinkConfigure: "src/HyperlinkConfigure.ts",
      Logs: "src/Logs.ts",
      LogEntry: "src/LogEntry.ts",
      LogContext: "src/LogContext.ts",
      HistoryStore: "src/HistoryStore.ts",
      DurableWorkPoolStore: "src/DurableWorkPoolStore.ts",
      Group: "src/Group.ts",
      Store: "src/Store.ts",
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
    // Shared UI core + web/tui renderers use relaxed UI rulesets — the root Effect-purity
    // plugin is wrong for Date/localStorage/React UI code. `clean` stays off so later
    // entries don't wipe earlier output.
    ...shared,
    entry: {
      Observe: "src/Observe.ts",
      ui: "src/ui/index.ts",
      "ui/WorkPoolView": "src/ui/WorkPoolView.ts",
      "ui/PriorityView": "src/ui/PriorityView.ts",
      "ui/DaemonView": "src/ui/DaemonView.ts",
      "ui/GateView": "src/ui/GateView.ts",
      "ui/ApiMetricsView": "src/ui/ApiMetricsView.ts",
      "ui/FleetHealthView": "src/ui/FleetHealthView.ts",
      "ui/TelemetryView": "src/ui/TelemetryView.ts",
      "ui/ShardMapView": "src/ui/ShardMapView.ts",
      "ui/NodeView": "src/ui/NodeView.ts",
      "ui/Navigator": "src/ui/Navigator.ts",
      "ui/Route": "src/ui/Route.ts",
      "ui/GroupRoute": "src/ui/GroupRoute.ts",
      "ui/GroupView": "src/ui/GroupView.ts",
      "ui/DashboardViews": "src/ui/DashboardViews.ts",
      "ui/DashboardLayer": "src/ui/DashboardLayer.ts",
    },
    tsconfig: "src/ui/tsconfig.json",
    dts: true,
    clean: false,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    ...shared,
    entry: {
      web: "src/web/index.ts",
      "web/WorkPoolView": "src/web/WorkPoolView.tsx",
      "web/DashboardViews": "src/web/DashboardViews.tsx",
      "web/NodeStatus": "src/web/NodeStatus.tsx",
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
      "tui/WorkPoolView": "src/tui/WorkPoolView.tsx",
      "tui/DashboardViews": "src/tui/DashboardViews.tsx",
    },
    tsconfig: "src/tui/tsconfig.json",
    dts: true,
    clean: false,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
