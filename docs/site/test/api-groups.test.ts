import { describe, expect, it } from "@effect/vitest";
import { groupSymbols } from "../src/lib/api-groups.js";
import type { ApiSymbolRow } from "../src/lib/api-data.js";

const row = (name: string, kind: string, category?: string): ApiSymbolRow => ({
  name,
  qualifiedName: `M.${name}`,
  kind,
  summary: "",
  url: `/api/x/M/${name}`,
  ...(category !== undefined ? { category } : {}),
});

describe("api-groups", () => {
  it("curated categories come first, in reading order, sorted within", () => {
    const groups = groupSymbols([
      row("map", "const", "combinators"),
      row("make", "const", "constructors"),
      row("Thing", "interface", "models"),
      row("isThing", "const", "guards"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Constructors", "Models", "Guards", "Combinators"]);
  });

  it("unknown categories follow alphabetically after curated ones", () => {
    const groups = groupSymbols([
      row("a", "const", "zebra stuff"),
      row("b", "const", "constructors"),
      row("c", "const", "aardvark stuff"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Constructors", "Aardvark Stuff", "Zebra Stuff"]);
    expect(groups[1]?.anchor).toBe("aardvark-stuff");
  });

  it("untagged symbols fall back to kind buckets, after tagged groups", () => {
    const groups = groupSymbols([
      row("make", "const", "constructors"),
      row("Shape", "interface"),
      row("Impl", "class"),
      row("helper", "const"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Constructors",
      "Classes",
      "Types",
      "Functions & Values",
    ]);
  });

  it("a single resulting group renders flat (no heading)", () => {
    const groups = groupSymbols([row("b", "const"), row("a", "const"), row("c", "function")]);
    expect(groups.length).toBe(1);
    expect(groups[0]?.label).toBe("");
    expect(groups[0]?.symbols.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("unexpected kinds land in Other instead of vanishing", () => {
    const groups = groupSymbols([row("Shape", "interface"), row("weird", "enum")]);
    expect(groups.map((g) => g.label)).toEqual(["Types", "Other"]);
  });
});
