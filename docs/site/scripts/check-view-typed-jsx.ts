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

const include = "examples/ui/view-typed-jsx/App.tsx";
const loaded = loadExampleIncludeFromDisk("../..", include, (abs) =>
  readFileSync(abs, "utf8"),
);
if (loaded === undefined) throw new Error("missing example");
if (!loaded.includes("Last.provide") || !loaded.includes("appLayer")) {
  throw new Error("demo must include Last.provide and appLayer");
}
if (loaded.includes("static layer") || loaded.includes("AppRoot.layer")) {
  throw new Error("demo must not teach static layer / Tag.layer");
}
if (loaded.includes("View.gen(") || loaded.includes("View.succeed(")) {
  throw new Error("View.gen / View.succeed masks are removed — use Effect/Layer");
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

const app = queries.find((q) => q.includes("const App:"));
if (!app) {
  throw new Error(`missing App query:\n${joined}`);
}
if (app.includes("Greeter") || app.includes("Hello")) {
  throw new Error(`App should have discharged deps, got: ${app}`);
}
if (joined.includes("<{}, any>") || joined.includes(": any")) {
  throw new Error(`queries must not show any:\n${joined}`);
}
console.log("ok");
