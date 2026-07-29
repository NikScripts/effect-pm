// Focused gate for `{.twoslash include=…}` example pages (see check-twoslash.ts for full corpus).
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { highlightToHast, loadHighlighter } from "../src/lib/highlight.js";
import {
  loadExampleIncludeFromDisk,
  prepareExampleForTwoslash,
} from "../src/lib/example-include.js";

const repoRoot = nodePath.resolve("../..");
const docsRoot = nodePath.resolve("..");
const examplesDocsRoot = nodePath.join(docsRoot, "examples");

const listMd = (dir: string): Array<string> => {
  const out: Array<string> = [];
  for (const name of readdirSync(dir)) {
    const abs = nodePath.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listMd(abs));
    else if (name.endsWith(".md")) {
      out.push(nodePath.relative(docsRoot, abs).split(nodePath.sep).join("/"));
    }
  }
  return out;
};

const pages = listMd(examplesDocsRoot).sort();
const fenceRe = /\{\.twoslash([^}]*)\}\s*\n```\s*ts\n([\s\S]*?)```/g;

await loadHighlighter();
let failed = 0;
let blocks = 0;
for (const rel of pages) {
  const raw = readFileSync(nodePath.join(docsRoot, rel), "utf8");
  for (const m of raw.matchAll(fenceRe)) {
    blocks += 1;
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
console.log(`done: ${blocks} blocks, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
