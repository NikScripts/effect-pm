// Focused gate for `{.twoslash include=…}` example pages (see check-twoslash.ts for full corpus).
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";
import { highlightToHast, loadHighlighter } from "../src/lib/highlight.js";
import {
  loadExampleIncludeFromDisk,
  prepareExampleForTwoslash,
} from "../src/lib/example-include.js";

const repoRoot = nodePath.resolve("../..");
const docsRoot = nodePath.resolve("..");
const pages = [
  "examples/queue/workpool-priority-retry.md",
  "examples/queue/workpool-priority-lanes.md",
  "examples/daemon-store/daemon-layer-store-auto-write.md",
  "examples/daemon-store/daemon-layer-typed-error-store.md",
  "examples/hyperlink/gate-unit-and-input.md",
  "examples/hyperlink/gate-rate-limit-fleet.md",
  "examples/hyperlink/gate-store-readback.md",
  "examples/hyperlink/http-client-gate.md",
  "examples/hyperlink/gate-http-api-client.md",
  "examples/hyperlink/gate-http-api-layer-effect.md",
  "examples/hyperlink/telemetry-fleet-glass.md",
  "examples/hyperlink/fleet-health-glass.md",
  "examples/hyperlink/shardmap-sessions.md",
];
const fenceRe = /\{\.twoslash([^}]*)\}\s*\n```\s*ts\n([\s\S]*?)```/g;

await loadHighlighter();
let failed = 0;
for (const rel of pages) {
  const raw = readFileSync(nodePath.join(docsRoot, rel), "utf8");
  for (const m of raw.matchAll(fenceRe)) {
    const include = /\binclude\s*=\s*"([^"]+)"/.exec(m[1] ?? "")?.[1]?.trim();
    let code = m[2] ?? "";
    if (include !== undefined && include !== "") {
      const loaded = loadExampleIncludeFromDisk(repoRoot, include, (abs) =>
        readFileSync(abs, "utf8"),
      );
      if (loaded === undefined) {
        failed += 1;
        console.log(`FAIL ${rel}: include not found: ${include}`);
        continue;
      }
      const prepared = prepareExampleForTwoslash(loaded, include);
      const preamble = code.trim();
      code = preamble === "" ? prepared : `${preamble}\n${prepared}`;
    }
    try {
      highlightToHast(code, "ts", { twoslash: true });
      console.log(`OK ${rel}${include !== undefined ? ` ← ${include}` : ""}`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${rel}: ${String(e).slice(0, 240).replace(/\n/g, " ")}`);
    }
  }
}
console.log(`done: ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
