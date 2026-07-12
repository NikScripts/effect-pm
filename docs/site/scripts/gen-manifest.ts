// Generate — or --check — docs/standards/manifest.json from the corpus blocks.
//
// Build tooling: runs offline and reads the corpus with node:fs (the no-node:* rule
// governs library src, not scripts). The parse/validate/build logic is the SHARED
// parser in ../src/lib/standards-manifest.ts — the same one the live docs page uses —
// so the manifest can never drift from what the page shows (Principles → Derive from
// the contract; the manifest is no longer hand-copied).
//
//   pnpm docs:manifest           regenerate manifest.json
//   pnpm docs:manifest --check   fail (exit 1) if manifest.json is stale

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { buildManifest, parseChapter } from "../src/lib/standards-manifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const standardsDir = path.resolve(here, "../../standards");
const manifestPath = path.join(standardsDir, "manifest.json");

// Parse every chapter through the shared pipeline, then assemble the manifest.
const build = Effect.gen(function* () {
  const files = fs
    .readdirSync(standardsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const metas = yield* Effect.forEach(files, (file) =>
    parseChapter(fs.readFileSync(path.join(standardsDir, file), "utf8")).pipe(
      Effect.map(({ meta }) => meta),
    ),
  );
  return buildManifest(metas);
});

const main = async () => {
  const check = process.argv.includes("--check");
  const manifest = await Effect.runPromise(build);
  const json = JSON.stringify(manifest, null, 2) + "\n";
  const summary = `${manifest.ruleCount} rules across ${manifest.chapters.length} chapters`;

  if (check) {
    const current = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
    if (current !== json) {
      console.error(`manifest.json is stale — run \`pnpm docs:manifest\`. (${summary})`);
      process.exit(1);
    }
    console.log(`manifest up to date — ${summary}`);
    return;
  }

  fs.writeFileSync(manifestPath, json);
  console.log(`wrote ${path.relative(process.cwd(), manifestPath)} — ${summary}`);
};

main().catch((err) => {
  console.error("manifest generation failed:", err);
  process.exit(1);
});
