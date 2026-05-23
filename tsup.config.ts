import { defineConfig } from "tsup";

const shared = {
  format: ["cjs", "esm"] as const,
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
      Query: "src/Query.ts",
      RuntimeStorage: "src/RuntimeStorage.ts",
      ProcessManager: "src/ProcessManager.ts",
      ControlService: "src/ControlService.ts",
      "storage/file": "src/storage/file.ts",
      "storage/sqlite": "src/storage/sqlite/index.ts",
      "storage/prisma": "src/storage/prisma.ts",
      "prisma/index": "src/prisma/index.ts",
      "bin/effect-pm": "src/bin/effect-pm.ts",
    },
    dts: true,
    clean: true,
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
