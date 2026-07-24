#!/usr/bin/env node
/**
 * Optional local-only NWSL SDP tree under `examples/scenarios/nwslsoccer/` (gitignored).
 * CI and fresh clones: exits 0 with a short message when the tree is missing.
 *
 *   node scripts/nwsl-local.mjs example   → tsx examples/scenarios/nwslsoccer/gate-http-api-client.ts
 *   node scripts/nwsl-local.mjs test      → vitest --config vitest.nwsl.config.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nwslRoot = join(root, "examples", "scenarios", "nwslsoccer");

const cmd = process.argv[2];

if (cmd === "example") {
  const entry = join(nwslRoot, "gate-http-api-client.ts");
  if (!existsSync(entry)) {
    console.log(
      "Skip: examples/scenarios/nwslsoccer/gate-http-api-client.ts not found (optional gitignored tree).",
    );
    process.exit(0);
  }
  const r = spawnSync("npx", ["tsx", entry], { stdio: "inherit", cwd: root, shell: true });
  process.exit(r.status ?? 1);
}

if (cmd === "test") {
  const testDir = join(nwslRoot, "test");
  if (!existsSync(testDir)) {
    console.log(
      "Skip: examples/scenarios/nwslsoccer/test not found (optional gitignored tree).",
    );
    process.exit(0);
  }
  const r = spawnSync(
    "npx",
    ["vitest", "run", "--config", "vitest.nwsl.config.ts"],
    { stdio: "inherit", cwd: root, shell: true },
  );
  process.exit(r.status ?? 1);
}

console.error("Usage: node scripts/nwsl-local.mjs <example|test>");
process.exit(1);
