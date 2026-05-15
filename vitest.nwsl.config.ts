/**
 * Vitest config for optional local tests under `examples/scenarios/nwslsoccer/test/` (gitignored).
 * Run: `npm run test:nwsl` (no-op when that folder is absent).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["examples/scenarios/nwslsoccer/test/**/*.test.ts"],
    pool: "forks",
  },
});
