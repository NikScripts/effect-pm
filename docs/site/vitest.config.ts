import { defineConfig } from "vitest/config";

// The docgen module (src/docgen) is node build tooling — tested in isolation from the Waku app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
  },
});
