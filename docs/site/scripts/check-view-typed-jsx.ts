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
for (const needle of ["View.succeed({ Hello }", "View.mount", "View.succeed({ Middle }"] as const) {
  if (!loaded.includes(needle)) {
    throw new Error(`demo must include ${needle}`);
  }
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

const hello = queries.find((q) => q.includes("const Hello:"));
const middle = queries.find((q) => q.includes("const Middle:"));
const outer = queries.find((q) => q.includes("const Outer:"));
const app = queries.find((q) => q.includes("const App:"));
if (!hello || !middle || !outer || !app) {
  throw new Error(`missing Hello/Middle/Outer/App queries:\n${joined}`);
}
for (const [name, q] of [
  ["Hello", hello],
  ["Middle", middle],
  ["Outer", outer],
] as const) {
  if (!q.includes("Greeter")) {
    throw new Error(`${name} must show Greeter, got: ${q}`);
  }
}
if (app.includes("Greeter")) {
  throw new Error(`App should have discharged Greeter, got: ${app}`);
}
if (joined.includes("<{}, any>") || joined.includes(": any")) {
  throw new Error(`queries must not show any:\n${joined}`);
}
console.log("ok");
