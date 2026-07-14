/**
 * Compile every `{.twoslash}` fenced block in selected guide pages.
 * Fails the process if twoslash reports errors (same compiler options as the docs site).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ts from "typescript";
import { createTwoslasher } from "twoslash";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const twoslasher = createTwoslasher({
  vfsRoot: repoRoot,
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    baseUrl: repoRoot,
    paths: {
      "@nikscripts/effect-pm": ["src/index.ts"],
      "@nikscripts/effect-pm/*": ["src/*"],
    },
  },
});

const pages = [
  "docs/index.md",
  "docs/getting-started/core-concepts.md",
  "docs/guides/queues.md",
  "docs/guides/logs.md",
  "docs/guides/telemetry.md",
  "docs/guides/shardmap.md",
];

const blockRe =
  /\{\.twoslash\}\s*\n```\s*ts\n([\s\S]*?)```/g;

let failed = 0;
for (const rel of pages) {
  const abs = path.join(repoRoot, rel);
  const raw = readFileSync(abs, "utf8");
  let i = 0;
  for (const match of raw.matchAll(blockRe)) {
    i += 1;
    const code = match[1] ?? "";
    try {
      const result = twoslasher(code, "ts");
      const errors = result.errors ?? [];
      if (errors.length > 0) {
        failed += 1;
        console.error(`\nFAIL ${rel} block #${i}`);
        for (const e of errors) {
          console.error(`  ${e.code ?? ""} ${e.text ?? e.message ?? e}`);
        }
      } else {
        console.log(`ok  ${rel} block #${i}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`\nFAIL ${rel} block #${i}`);
      console.error(err);
    }
  }
  if (i === 0) {
    console.error(`FAIL ${rel}: no {.twoslash} blocks found`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} twoslash block(s) failed`);
  process.exit(1);
}
console.log("\nall twoslash blocks ok");
