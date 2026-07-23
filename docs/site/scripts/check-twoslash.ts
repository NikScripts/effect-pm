// Render every {.twoslash} block in the content corpus sequentially — the fast iteration gate
// for doc-sample drift (the full build does the same validation, ~6 min slower). A block that
// fails here would fail `pnpm build`.
//
//   tsx scripts/check-twoslash.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { highlightToHast, loadHighlighter } from "../src/lib/highlight.js";

const docsRoot = nodePath.resolve("..");
const skip = new Set(["site", "handoffs", "legacy", "plans", "docgen"]);
const files: Array<string> = [];
const walk = (dir: string): void => {
  for (const e of readdirSync(dir)) {
    const abs = nodePath.join(dir, e);
    if (statSync(abs).isDirectory()) {
      if (dir !== docsRoot || !skip.has(e)) walk(abs);
    } else if (e.endsWith(".md")) files.push(abs);
  }
};
walk(docsRoot);
files.sort();
await loadHighlighter();
let blocks = 0;
let failed = 0;
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  for (const m of raw.matchAll(/\{\.twoslash\}\n``` ts\n([\s\S]*?)```/g)) {
    blocks += 1;
    try {
      highlightToHast(m[1], "ts", { twoslash: true });
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${nodePath.relative(docsRoot, f)}: ${String(e).slice(0, 120).replace(/\n/g, " ")}`);
    }
  }
}
console.log(`seq done: ${blocks} blocks, ${failed} failed`);
