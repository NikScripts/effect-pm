import { defineConfig } from "vitest/config";

// The docgen package (@nikscripts/docgen, docs/docgen) is node build tooling — tested in isolation
// from the Waku app; its tests live in test/docgen and import through the package subpaths.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
  },
});
