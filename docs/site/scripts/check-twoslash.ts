// Render every {.twoslash} block in the content corpus sequentially — the fast iteration gate
// for doc-sample drift (the full build does the same validation, ~6 min slower). A block that
// fails here would fail `pnpm build`.
//
// Supports `{.twoslash include="examples/…"}` (empty fence body) — same rewrite as the site.
//
//   tsx scripts/check-twoslash.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { highlightToHast, loadHighlighter } from "../src/lib/highlight.js";
import {
  loadExampleIncludeFromDisk,
  prepareExampleForTwoslash,
} from "../src/lib/example-include.js";

const docsRoot = nodePath.resolve("..");
const repoRoot = nodePath.resolve("../..");
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

const fenceRe =
  /\{\.twoslash([^}]*)\}\s*\n```\s*tsx?\n([\s\S]*?)```/g;

const includeFromAttrs = (attrs: string): string | undefined => {
  const m = /\binclude\s*=\s*"([^"]+)"/.exec(attrs);
  return m?.[1]?.trim();
};

let blocks = 0;
let failed = 0;
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  for (const m of raw.matchAll(fenceRe)) {
    blocks += 1;
    const include = includeFromAttrs(m[1] ?? "");
    let code = m[2] ?? "";
    if (include !== undefined && include !== "") {
      const loaded = loadExampleIncludeFromDisk(repoRoot, include, (abs) =>
        readFileSync(abs, "utf8"),
      );
      if (loaded === undefined) {
        failed += 1;
        console.log(
          `FAIL ${nodePath.relative(docsRoot, f)}: include not found: ${include}`,
        );
        continue;
      }
      const prepared = prepareExampleForTwoslash(loaded, include);
      const preamble = code.trim();
      code = preamble === "" ? prepared : `${preamble}\n${prepared}`;
    }
    try {
      highlightToHast(code, "ts", { twoslash: true });
    } catch (e) {
      failed += 1;
      console.log(
        `FAIL ${nodePath.relative(docsRoot, f)}: ${String(e).slice(0, 120).replace(/\n/g, " ")}`,
      );
    }
  }
}
console.log(`seq done: ${blocks} blocks, ${failed} failed`);
