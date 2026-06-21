import { defineConfig } from "vitest/config";

// The TUI tests are TSX and live under examples/, so they run via this config
// rather than the root test/**/*.ts glob.
export default defineConfig({
  test: {
    include: ["examples/resource-tui/**/*.test.tsx"],
  },
});
