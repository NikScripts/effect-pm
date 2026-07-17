import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as Extractor from "../../src/docgen/Extractor.js";
import * as TsProgram from "../../src/docgen/TsProgram.js";

const fixture = fileURLToPath(new URL("./fixtures/extract-fixture.ts", import.meta.url));
const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  noEmit: true,
};

const layer = Extractor.layer({
  repoRoot: fixturesDir,
  srcDir: fixturesDir,
  slug: "test",
  repoBaseUrl: "",
  repoPathPrefix: "",
  isPublic: (sym, checker) => sym.getJsDocTags(checker).some((t) => t.name === "since"),
}).pipe(Layer.provideMerge(TsProgram.layer({ entries: [fixture], compilerOptions })));

const exportNamed = (program: TsProgram.TsProgram, name: string): ts.Symbol => {
  const sf = Option.getOrThrow(program.sourceFile(fixture));
  const moduleSym = Option.getOrThrow(
    Option.fromNullishOr(program.checker.getSymbolAtLocation(sf))
  );
  const found = program.checker.getExportsOfModule(moduleSym).find((e) => e.getName() === name);
  if (found === undefined) throw new Error(`no export '${name}'`);
  return found;
};

describe("Extractor", () => {
  it.effect("extracts a public export into a full Model.Symbol", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const extractor = yield* Extractor.Extractor;
      const model = Option.getOrThrow(
        extractor.symbol(Option.none(), exportNamed(program, "makeWidget"))
      );
      expect(model.name).toBe("makeWidget");
      expect(model.qualifiedName).toBe("makeWidget");
      expect(model.entry).toBe("(top-level)");
      expect(model.url).toBe("/api/test/top-level/makeWidget");
      expect(model.kind).toBe("const");
      expect(model.signatures.length).toBeGreaterThan(0);
      expect(model.category).toBe("constructors");
      expect(model.tags).toContainEqual({ name: "since", text: "1.0.0" });
      expect(model.summary).toBe("Makes a widget from an id.");
      expect(model.source.file).toBe("extract-fixture.ts");
      expect(model.source.url).toBeUndefined(); // repoBaseUrl ""
      expect(model.docLinks).toStrictEqual({}); // filled by the second pass
    }).pipe(Effect.provide(layer))
  );

  it.effect("skips a non-public export (no @since here)", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const extractor = yield* Extractor.Extractor;
      expect(Option.isNone(extractor.symbol(Option.none(), exportNamed(program, "Widget")))).toBe(
        true
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect("qualifies the name under a namespace", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const extractor = yield* Extractor.Extractor;
      const model = Option.getOrThrow(
        extractor.symbol(Option.some("Widgets"), exportNamed(program, "makeWidget"))
      );
      expect(model.qualifiedName).toBe("Widgets.makeWidget");
      expect(model.entry).toBe("Widgets");
      expect(model.url).toBe("/api/test/Widgets/makeWidget");
    }).pipe(Effect.provide(layer))
  );
});
