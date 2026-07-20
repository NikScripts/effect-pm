// Module-page symbol grouping. Curated `@category` tags rule where the source provides them
// (effect tags ~all of its exports); untagged symbols fall back to kind buckets so a module with
// no tags still reads in sections instead of one flat wall. A module that would render a single
// group stays flat — one heading over everything is noise, not structure.

import type { ApiSymbolRow } from "./api-data.js";
import { slugify } from "./slug-text.js";

export interface SymbolGroup {
  readonly label: string;
  readonly anchor: string;
  readonly symbols: ReadonlyArray<ApiSymbolRow>;
}

// effect's @category vocabulary, in reading order: what you construct with first, the shapes,
// then the verbs. Unknown categories follow alphabetically; kind buckets close the page.
const categoryOrder = [
  "constructors",
  "models",
  "type ids",
  "guards",
  "refinements",
  "getters",
  "elements",
  "combinators",
  "mapping",
  "filtering",
  "sequencing",
  "mutations",
  "destructors",
  "conversions",
  "interop",
  "utils",
];

const kindBuckets: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["Namespaces", ["namespace"]],
  ["Classes", ["class"]],
  ["Types", ["interface", "type"]],
  ["Functions & Values", ["function", "const"]],
];

const titleCase = (s: string): string => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

const byName = (a: ApiSymbolRow, b: ApiSymbolRow): number =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

export const groupSymbols = (symbols: ReadonlyArray<ApiSymbolRow>): ReadonlyArray<SymbolGroup> => {
  const tagged = new Map<string, Array<ApiSymbolRow>>();
  const untagged: Array<ApiSymbolRow> = [];
  for (const s of symbols) {
    if (s.category !== undefined && s.category !== "") {
      const key = s.category.toLowerCase();
      const bucket = tagged.get(key);
      if (bucket === undefined) tagged.set(key, [s]);
      else bucket.push(s);
    } else {
      untagged.push(s);
    }
  }

  const known = categoryOrder.filter((c) => tagged.has(c));
  const unknown = [...tagged.keys()].filter((c) => !categoryOrder.includes(c)).sort();
  const groups: Array<SymbolGroup> = [...known, ...unknown].map((c) => ({
    label: titleCase(c),
    anchor: slugify(c),
    symbols: [...(tagged.get(c) ?? [])].sort(byName),
  }));

  for (const [label, kinds] of kindBuckets) {
    const bucket = untagged.filter((s) => kinds.includes(s.kind));
    if (bucket.length > 0) {
      groups.push({
        label,
        anchor: slugify(label),
        symbols: [...bucket].sort(byName),
      });
    }
  }
  // anything with an unexpected kind still renders
  const bucketed = new Set(kindBuckets.flatMap(([, kinds]) => kinds));
  const rest = untagged.filter((s) => !bucketed.has(s.kind));
  if (rest.length > 0) {
    groups.push({
      label: "Other",
      anchor: "other",
      symbols: [...rest].sort(byName),
    });
  }

  return groups.length === 1
    ? [
        {
          label: "",
          anchor: "",
          symbols: [...symbols].sort(byName),
        },
      ]
    : groups;
};
