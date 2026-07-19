import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as HoverRenderer from "../../src/docgen/HoverRenderer.js";
import * as LinkResolver from "../../src/docgen/LinkResolver.js";
import * as SymbolIndex from "../../src/docgen/SymbolIndex.js";
import * as TsProgram from "../../src/docgen/TsProgram.js";
import * as TypePrinter from "../../src/docgen/TypePrinter.js";

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

const provided = HoverRenderer.layer.pipe(
  Layer.provideMerge(TypePrinter.layer),
  Layer.provideMerge(LinkResolver.layer({ repoRoot })),
  Layer.provideMerge(
    Layer.mergeAll(TsProgram.layer({ entries: [fixture], compilerOptions }), index)
  )
);

const exportSymbol = (program: TsProgram.TsProgram, name: string): ts.Symbol => {
  const sf = Option.getOrThrow(program.sourceFile(fixture));
  const moduleSymbol = program.checker.getSymbolAtLocation(sf);
  if (moduleSymbol === undefined) throw new Error("no module symbol for the fixture");
  const symbol = program.checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === name);
  if (symbol === undefined) throw new Error(`no export '${name}' in fixture`);
  return symbol;
};

describe("HoverRenderer", () => {
  it.effect("renders a value export's hover: value type, text and links agree", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const renderer = yield* HoverRenderer.HoverRenderer;
      const hover = Option.getOrThrow(renderer.hover(exportSymbol(program, "use")));

      expect(hover.text).toBe("(holder: Holder<Target>) => Target");
      expect(
        hover.links.map((link) => [hover.text.slice(link.start, link.end), link.url])
      ).toStrictEqual([
        ["Holder", "/api/test/Holder"],
        ["Target", "/api/test/Target"],
        ["Target", "/api/test/Target"],
      ]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("renders a type alias's hover from its right-hand side, linked", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const renderer = yield* HoverRenderer.HoverRenderer;
      const hover = Option.getOrThrow(renderer.hover(exportSymbol(program, "MaybeTarget")));

      expect(hover.text).toBe("Target | undefined");
      expect(
        hover.links.map((link) => [hover.text.slice(link.start, link.end), link.url])
      ).toStrictEqual([["Target", "/api/test/Target"]]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("renders an interface's hover as its self-reference, unlinked", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const renderer = yield* HoverRenderer.HoverRenderer;
      const hover = Option.getOrThrow(renderer.hover(exportSymbol(program, "Holder")));

      // The compiler renders a declared interface type as the bare self-name; a hover never links
      // the symbol it describes, so no links is the CORRECT outcome here.
      expect(hover.text).toBe("Holder<A>");
      expect(hover.links).toStrictEqual([]);
    }).pipe(Effect.provide(provided))
  );
});
