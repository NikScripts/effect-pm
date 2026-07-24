// One-shot migration: re-stamp api-hovers/cache.json to the CURRENT pipelineVersion WITHOUT
// re-hovering anything.
//
// Why this exists: gen-hovers keys every cached sidecar `${pipelineVersion}:${sha1(fileText)}`,
// where pipelineVersion is a hash of the hover pipeline's own sources (gen-hovers.ts + src/lib +
// docgen/src — now comment/type-invariant via pipelineFingerprint). When that logic itself changes
// (e.g. adding pipelineFingerprint), pipelineVersion moves ONCE, which would otherwise force a cold
// re-hover of the whole surface. If the change is OUTPUT-NEUTRAL — it alters how the version is
// COMPUTED, not the hover HTML the sidecars hold — the cached sidecars are still valid, so we can
// just rewrite the version prefix on every entry. gen-hovers then skips every unchanged source and
// re-hovers only the files whose content actually changed.
//
//   tsx scripts/restamp-hover-cache.ts            dry run — print old→new version + entry count
//   tsx scripts/restamp-hover-cache.ts --write    rewrite cache.json in place
//
// PRECONDITION (caller's responsibility): the pipeline changes since the cache was built are
// output-neutral (comment/rename/version-calc only). If you changed how a hover is RENDERED
// (highlight.ts logic, hast-html, the type expander, twoslash options), DO NOT restamp — let
// gen-hovers cold-regen. When unsure, delete api-hovers/ and regen; correctness beats the shortcut.

import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const siteDir = nodePath.join(repoRoot, "docs/site");
const cachePath = nodePath.join(siteDir, "api-hovers/cache.json");

// MUST stay identical to gen-hovers.ts::pipelineFingerprint — comment/type-erased emit, raw-text
// fallback on transpile miss.
const pipelineFingerprint = (fileName: string, text: string): string => {
  try {
    const out = ts.transpileModule(text, {
      fileName,
      reportDiagnostics: false,
      compilerOptions: {
        removeComments: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        isolatedModules: true,
      },
    }).outputText;
    return out.length > 0 ? out : text;
  } catch {
    return text;
  }
};

// MUST stay identical to gen-hovers.ts::pipelineVersion (same source set, sort, fingerprint, slice).
const computePipelineVersion = (): string => {
  const dirFiles = (dir: string): ReadonlyArray<string> => {
    try {
      return nodeFs
        .readdirSync(nodePath.join(siteDir, dir))
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => `${dir}/${f}`);
    } catch {
      return [];
    }
  };
  const sources = [
    "scripts/gen-hovers.ts",
    ...dirFiles("src/lib"),
    ...dirFiles("../docgen/src"),
  ].sort();
  const hasher = createHash("sha1");
  for (const rel of sources) {
    let text = "";
    try {
      text = nodeFs.readFileSync(nodePath.join(siteDir, rel), "utf8");
    } catch {
      text = "";
    }
    hasher.update(pipelineFingerprint(rel, text));
  }
  return hasher.digest("hex").slice(0, 12);
};

const write = process.argv.includes("--write");

if (!nodeFs.existsSync(cachePath)) {
  console.error(`no cache at ${nodePath.relative(repoRoot, cachePath)} — nothing to restamp`);
  process.exit(1);
}

const cache: Record<string, string> = JSON.parse(nodeFs.readFileSync(cachePath, "utf8"));
const newVersion = computePipelineVersion();

const oldVersions = new Set<string>();
const next: Record<string, string> = {};
let restamped = 0;
for (const [rel, value] of Object.entries(cache)) {
  const idx = value.indexOf(":");
  if (idx < 0) {
    next[rel] = value; // malformed — leave untouched
    continue;
  }
  const oldVersion = value.slice(0, idx);
  oldVersions.add(oldVersion);
  const restampedValue = `${newVersion}${value.slice(idx)}`;
  if (restampedValue !== value) restamped += 1;
  next[rel] = restampedValue;
}

const entries = Object.keys(cache).length;
console.log(`cache entries:        ${entries}`);
console.log(`old pipelineVersion:  ${[...oldVersions].join(", ") || "(none)"}`);
console.log(`new pipelineVersion:  ${newVersion}`);
console.log(`entries to restamp:   ${restamped}`);

if (restamped === 0) {
  console.log("already current — no restamp needed.");
  process.exit(0);
}

if (!write) {
  console.log("\ndry run — re-run with --write to apply.");
  process.exit(0);
}

nodeFs.writeFileSync(cachePath, `${JSON.stringify(next)}\n`);
console.log(`\nrestamped ${restamped} entries → ${newVersion}. Next gen-hovers re-hovers only changed sources.`);
