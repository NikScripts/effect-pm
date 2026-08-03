import { readFileSync } from "node:fs";
import { highlightToHast, loadHighlighter } from "../src/lib/highlight.js";
import {
  loadExampleIncludeFromDisk,
  prepareExampleForTwoslash,
} from "../src/lib/example-include.js";

await loadHighlighter();
const include = "examples/ui/view-typed-jsx.tsx";
const loaded = loadExampleIncludeFromDisk("../..", include, (abs) =>
  readFileSync(abs, "utf8"),
);
if (loaded === undefined) throw new Error("missing example");
const code = prepareExampleForTwoslash(loaded, include);
const hast = highlightToHast(code, "tsx", { twoslash: true });
const text = JSON.stringify(hast);
for (const k of ["PageNeeds", "Greeter", "Clock", "ChildNeeds", "TreeNeeds", "ThroughRadix"]) {
  console.log(k, text.includes(k));
}
if (!text.includes("Greeter") || !text.includes("Clock")) {
  throw new Error("expected Greeter|Clock in twoslash output");
}
console.log("ok");
