import { defineConfig } from "vitest/config";

// Launcher / Update suites spawn real `pnpm exec tsx` fixture children and kill them by
// process-group signal. Under full-suite parallelism the spawn storms and group kills
// leak across concurrently running files (children die by signal → `ChildProcess.exitCode`
// PlatformError), so those files run in their own serial project.
const spawnHeavy = [
  "test/launcher.test.ts",
  "test/launcher-already-up.test.ts",
  "test/update.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    projects: [
      {
        test: {
          name: "main",
          environment: "node",
          pool: "forks",
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          exclude: ["**/node_modules/**", ...spawnHeavy],
        },
      },
      {
        test: {
          name: "spawn-serial",
          environment: "node",
          pool: "forks",
          fileParallelism: false,
          include: spawnHeavy,
        },
      },
    ],
  },
});
