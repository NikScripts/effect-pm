import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as SymbolIndex from "../../src/docgen/SymbolIndex.js";

const entries: ReadonlyArray<SymbolIndex.Entry> = [
  { file: "src/Layer.ts", line: 54, url: "/api/effect/Layer/Layer" },
  { file: "src/Scope.ts", line: 12, url: "/api/effect/Scope/Scope" },
];

describe("SymbolIndex", () => {
  it.effect("maps a known declaration location to its url", () =>
    Effect.gen(function* () {
      const index = yield* SymbolIndex.SymbolIndex;
      expect(index.urlAt("src/Layer.ts", 54)).toStrictEqual(Option.some("/api/effect/Layer/Layer"));
      expect(index.urlAt("src/Scope.ts", 12)).toStrictEqual(Option.some("/api/effect/Scope/Scope"));
    }).pipe(Effect.provide(SymbolIndex.layer(entries)))
  );

  it.effect("is none for an unknown location or a near-miss line", () =>
    Effect.gen(function* () {
      const index = yield* SymbolIndex.SymbolIndex;
      expect(Option.isNone(index.urlAt("src/Layer.ts", 55))).toBe(true);
      expect(Option.isNone(index.urlAt("src/Other.ts", 54))).toBe(true);
    }).pipe(Effect.provide(SymbolIndex.layer(entries)))
  );

  it.effect("last entry wins for a duplicated location", () =>
    Effect.gen(function* () {
      const index = yield* SymbolIndex.SymbolIndex;
      expect(index.urlAt("src/Dup.ts", 1)).toStrictEqual(Option.some("/b"));
    }).pipe(
      Effect.provide(
        SymbolIndex.layer([
          { file: "src/Dup.ts", line: 1, url: "/a" },
          { file: "src/Dup.ts", line: 1, url: "/b" },
        ])
      )
    )
  );
});
