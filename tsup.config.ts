import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  splitting: false,
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
      QueueResource: "src/QueueResource.ts",
      ProcessGroup: "src/ProcessGroup.ts",
      ProcessStore: "src/ProcessStore.ts",
      ProcessStorage: "src/ProcessStorage.ts",
      "store/QueueResource": "src/store/queueResource.ts",
      "store/Log": "src/store/log.ts",
      "store/RunResource": "src/store/runResource.ts",
      "store/ProcessLifecycle": "src/store/processLifecycle.ts",
      "store/ProcessGroup": "src/store/processGroup.ts",
      "store/ProcessExecution": "src/store/processExecution.ts",
      Query: "src/Query.ts",
      ResourceConfigure: "src/ResourceConfigure.ts",
      RuntimeStorage: "src/RuntimeStorage.ts",
      CommandAuth: "src/CommandAuth.ts",
      ControlProtocol: "src/ControlProtocol.ts",
      ControlTransportRpc: "src/ControlTransportRpc.ts",
      LogTransportRpc: "src/LogTransportRpc.ts",
      Terminal: "src/Terminal.ts",
      TerminalRpc: "src/TerminalRpc.ts",
      ProcessManager: "src/ProcessManager.ts",
      ControlService: "src/ControlService.ts",
      Logs: "src/Logs.ts",
      HostLogs: "src/HostLogs.ts",
      "storage/sqlite": "src/storage/sqlite/index.ts",
      "storage/redis": "src/storage/redis/index.ts",
      "storage/prisma": "src/storage/prisma.ts",
      "prisma/index": "src/prisma/index.ts",
      "bin/effect-pm": "src/bin/effect-pm.ts",
    },
    dts: true,
    clean: true,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    ...shared,
    entry: {
      "bin/effect-pm-group-child": "src/bin/effect-pm-group-child.ts",
    },
    dts: false,
    clean: false,
  },
]);
