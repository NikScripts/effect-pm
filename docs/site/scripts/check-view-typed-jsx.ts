import { readFileSync } from "node:fs";
import { createTwoslasher } from "twoslash";
import ts from "typescript";
import * as nodePath from "node:path";
import {
  loadExampleIncludeFromDisk,
  prepareExampleForTwoslash,
} from "../src/lib/example-include.js";

const repoRoot = nodePath.resolve(process.cwd(), "../..");
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  allowImportingTsExtensions: true,
  noEmit: true,
  baseUrl: repoRoot,
  jsx: ts.JsxEmit.ReactJSX,
  paths: {
    "last-ts": ["packages/last-ts/src/index.ts"],
    "last-ts/*": ["packages/last-ts/src/*"],
  },
};

const include = "examples/ui/view-typed-jsx.tsx";
const loaded = loadExampleIncludeFromDisk("../..", include, (abs) =>
  readFileSync(abs, "utf8"),
);
if (loaded === undefined) throw new Error("missing example");
// Anti-cheat: no witnessing Inner’s R onto parents via stamp/ServicesOf.
if (/stamp\s*</.test(loaded) || /ServicesOf\s*</.test(loaded)) {
  throw new Error(
    "demo must not use stamp<…> or ServicesOf<…> (no fake R witnesses)",
  );
}
const code = prepareExampleForTwoslash(loaded, include);
const result = createTwoslasher({ vfsRoot: repoRoot, compilerOptions })(
  code,
  "tsx",
);
if (result.errors?.length) {
  throw new Error(
    `twoslash errors: ${JSON.stringify(result.errors.slice(0, 3))}`,
  );
}
const queries = (result.queries ?? []).map((q) => q.text);
const joined = queries.join("\n");
console.log("queries:\n", joined);
for (const name of ["Inner", "Middle", "Outer"] as const) {
  const q = queries.find((line) => line.includes(` ${name}:`) || line.includes(`const ${name}:`));
  if (q === undefined) {
    throw new Error(`missing ${name} query:\n${joined}`);
  }
  if (!q.includes("Greeter")) {
    throw new Error(`${name} must show Greeter, got: ${q}`);
  }
  if (q.includes("any")) {
    throw new Error(`${name} must not be any, got: ${q}`);
  }
}
console.log("ok");
