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
// Anti-cheat: demo must not witness Inner’s R onto Outer via stamp type args.
if (/stamp\s*</.test(loaded) || /ServicesOf\s*<\s*typeof\s+Inner/.test(loaded)) {
  throw new Error(
    "demo must not use View.stamp<…> or ServicesOf<typeof Inner> (no fake R)",
  );
}
if (!/function Middle\b/.test(loaded) && !/const Middle\b/.test(loaded)) {
  throw new Error("demo must include a plain Middle component");
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
const innerQ = queries.find((q) => q.includes("Inner"));
const outerQ = queries.find((q) => q.includes("Outer"));
if (innerQ === undefined || outerQ === undefined) {
  throw new Error(`expected Inner/Outer queries, got:\n${joined}`);
}
if (!innerQ.includes("Greeter")) {
  throw new Error(`Inner must show Greeter, got: ${innerQ}`);
}
if (joined.includes(": any") || joined.includes("<{}, any>")) {
  throw new Error(`queries must not show any:\n${joined}`);
}
console.log("ok");
console.log("Outer query:", outerQ);
