import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as LinkResolver from "@nikscripts/docgen/LinkResolver";
import * as SourceRenderer from "@nikscripts/docgen/SourceRenderer";
import * as SymbolIndex from "@nikscripts/docgen/SymbolIndex";
import * as TsProgram from "@nikscripts/docgen/TsProgram";

const fixture = fileURLToPath(new URL("./fixtures/print-fixture.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  noEmit: true,
};

// `Target` is declared on line 1 and `Holder` on line 4 of the fixture (see print-fixture.ts).
const index = SymbolIndex.layer([
  {
    file: "print-fixture.ts",
    line: 1,
    url: "/api/test/Target",
  },
  {
    file: "print-fixture.ts",
    line: 4,
    url: "/api/test/Holder",
  },
]);

const provided = SourceRenderer.layer.pipe(
  Layer.provideMerge(LinkResolver.layer({ repoRoot })),
  Layer.provideMerge(
    Layer.mergeAll(TsProgram.layer({ entries: [fixture], compilerOptions }), index)
  )
);

// The span's text, sliced the same way the service computes it (inclusive 1-based lines).
const sliceOf = (sf: ts.SourceFile, startLine: number, endLine: number): string => {
  const lineStarts = sf.getLineStarts();
  const start = lineStarts[startLine - 1];
  const end = endLine < lineStarts.length ? lineStarts[endLine] : sf.text.length;
  return sf.text.slice(start, end);
};

describe("SourceRenderer", () => {
  // Line 7: `export const use = (holder: Holder<Target>): Target => holder.value;`
  it.effect("links every documented identifier in the span, offsets span-relative", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const renderer = yield* SourceRenderer.SourceRenderer;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      const text = sliceOf(sf, 7, 7);
      const links = Option.getOrThrow(
        renderer.links({
          file: fixture,
          startLine: 7,
          endLine: 7,
        })
      );

      expect(links.map((link) => [text.slice(link.start, link.end), link.url])).toStrictEqual([
        ["Holder", "/api/test/Holder"],
        ["Target", "/api/test/Target"],
        ["Target", "/api/test/Target"],
      ]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("spans several lines (interface body references stay linked)", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const renderer = yield* SourceRenderer.SourceRenderer;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      // Lines 4–6: the whole `Holder<A>` interface — `A` is a type parameter (no page).
      const text = sliceOf(sf, 4, 6);
      const links = Option.getOrThrow(
        renderer.links({
          file: fixture,
          startLine: 4,
          endLine: 6,
        })
      );

      expect(links.map((link) => [text.slice(link.start, link.end), link.url])).toStrictEqual([
        ["Holder", "/api/test/Holder"],
      ]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("returns none for a file the program does not know", () =>
    Effect.gen(function* () {
      const renderer = yield* SourceRenderer.SourceRenderer;
      expect(
        Option.isNone(
          renderer.links({
            file: "/nowhere/else.ts",
            startLine: 1,
            endLine: 1,
          })
        )
      ).toBe(true);
    }).pipe(Effect.provide(provided))
  );

  it.effect("returns none for a span outside the file", () =>
    Effect.gen(function* () {
      const renderer = yield* SourceRenderer.SourceRenderer;
      expect(
        Option.isNone(
          renderer.links({
            file: fixture,
            startLine: 999,
            endLine: 999,
          })
        )
      ).toBe(true);
    }).pipe(Effect.provide(provided))
  );
});
