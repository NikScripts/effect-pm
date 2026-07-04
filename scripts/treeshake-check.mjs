// Tree-shaking gate for the tree-shakeable namespace subpaths.
//
// A browser/dashboard bundle that imports only the *light* contract tag (`NS.Tag`) must NOT pull the
// runtime engine (workers, refill, rate limiter, the supervisor loop). We prove that by bundling a
// `.Tag`-only consumer straight from each namespace ENTRY source with esbuild (relative imports
// bundled, everything in node_modules externalized), then asserting the engine source contributes
// **zero bytes** to the output. This reads source, not dist, so it measures the authored structure
// independent of chunking.
//
// NB: we inspect `metafile.outputs[*].inputs` (files that contribute *retained* bytes), NOT
// `metafile.inputs` (every file esbuild *parsed*). A namespace that re-exports engine bindings
// (`export { … } from "./internal/engine"`) forces esbuild to parse the engine to resolve the
// namespace, so it always shows up in `metafile.inputs` even when fully tree-shaken away. Only the
// retained-bytes view reflects what actually ships.
//
// Usage: node scripts/treeshake-check.mjs   (exit 1 if any case regresses)

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {object} Case
 * @property {string} name       subpath name (for reporting)
 * @property {string} entry      namespace entry source (what the subpath resolves to)
 * @property {string[]} engine   source files that MUST be dropped for a `.Tag`-only import
 * @property {string} member     the light member the consumer touches
 */

/** @type {Case[]} */
const cases = [
  {
    name: "QueueResource",
    entry: "src/QueueResource.ts",
    engine: ["src/internal/queueResource.ts"],
    member: "Tag",
  },
  {
    name: "CustomQueueResource",
    entry: "src/internal/customQueueResourceNamespace.ts",
    engine: ["src/CustomQueueResource.ts", "src/internal/queueResource.ts"],
    member: "Tag",
  },
  {
    name: "ScheduledProcess",
    entry: "src/internal/scheduledProcessNamespace.ts",
    engine: ["src/Process.ts"],
    member: "Tag",
  },
];

const bundleTagOnly = async (entryAbs, member) => {
  const result = await build({
    stdin: {
      // `import * as NS` + touching only one light member: esbuild tracks the property access and
      // tree-shakes every other member (and its transitive imports) away.
      contents: `import * as NS from ${JSON.stringify(entryAbs)};\nexport const probe = NS.${member};\n`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    metafile: true,
    treeShaking: true,
    format: "esm",
    platform: "neutral",
    // Externalize everything in node_modules (effect, @effect/*, react, sql, …) so the graph contains
    // only this package's own src files — exactly what we want to assert over.
    packages: "external",
    logLevel: "silent",
  });
  // Files that contribute *retained* bytes to the output (post-tree-shake), not the parse graph.
  const outKey = Object.keys(result.metafile.outputs)[0];
  const retained = result.metafile.outputs[outKey].inputs;
  const inputs = Object.keys(retained)
    .filter((p) => !p.startsWith("<") && !p.includes("node_modules"))
    .map((p) => relative(root, resolve(root, p)))
    .sort();
  const bytes = result.outputFiles.reduce((n, f) => n + f.contents.byteLength, 0);
  return { inputs, bytes };
};

let failed = false;
const lines = [];

for (const c of cases) {
  const entryAbs = resolve(root, c.entry);
  const { inputs, bytes } = await bundleTagOnly(entryAbs, c.member);
  const leaked = c.engine.filter((e) => inputs.includes(e));
  const ok = leaked.length === 0;
  failed ||= !ok;
  lines.push(
    `${ok ? "PASS" : "FAIL"}  ${c.name}.${c.member}  → ${inputs.length} src file(s), ${(bytes / 1024).toFixed(1)} KB bundled`,
  );
  if (!ok) {
    lines.push(`      LEAKED engine source into a Tag-only import: ${leaked.join(", ")}`);
  }
  lines.push(`      inputs: ${inputs.join(", ") || "(none)"}`);
}

console.log(lines.join("\n"));
console.log(failed ? "\ntree-shake check: FAIL" : "\ntree-shake check: PASS");
process.exit(failed ? 1 : 0);
