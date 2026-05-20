import { defineConfig } from "tsup";

export default defineConfig({
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
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: "dist",
  external: [
    // Optional peer — never bundle.
    "@prisma/client",
    "@effect/sql-sqlite-node",
  ],
});
