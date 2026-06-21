import { defineConfig } from "vitest/config";

// The TUI test is TSX (imports Ink) and Ink is ESM-only (yoga-layout uses
// top-level await), so it runs under Vite/Vitest, not the root .ts test glob.
export default defineConfig({
  test: {
    include: ["examples/resource-tui/**/*.test.tsx"],
  },
});
