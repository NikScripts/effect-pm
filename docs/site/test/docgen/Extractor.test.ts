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

  it.effect("records the declaration's statement line", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const extractor = yield* Extractor.Extractor;
      const model = Option.getOrThrow(
        extractor.symbol(Option.none(), exportNamed(program, "makeWidget"))
      );
      expect(model.source.line).toBe(7); // the `export const` statement, not the JSDoc
    }).pipe(Effect.provide(layer))
  );

  it.effect("uses typeText (no signatures) for a non-callable value", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const extractor = yield* Extractor.Extractor;
      const model = Option.getOrThrow(
        extractor.symbol(Option.none(), exportNamed(program, "answer"))
      );
      expect(model.kind).toBe("const");
      expect(model.signatures).toStrictEqual([]);
      expect(model.typeText).toBe("42");
    }).pipe(Effect.provide(layer))
  );

  it.effect("captures every overload and the whole declaration span", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const extractor = yield* Extractor.Extractor;
      const model = Option.getOrThrow(
        extractor.symbol(Option.none(), exportNamed(program, "twice"))
      );
      expect(model.kind).toBe("function");
      expect(model.signatures).toHaveLength(2); // the two overloads; the implementation is not one
      expect(model.typeText).toBeUndefined();
      // the source span covers overloads AND the implementation body
      expect(model.sourceText).toContain("(value: number): number;");
      expect(model.sourceText).toContain("(value: string): string;");
      expect(model.sourceText).toContain('typeof value === "number"');
    }).pipe(Effect.provide(layer))
  );
});

// --- package walk + {@link} second pass over the fixture package ---

const pkgDir = fileURLToPath(new URL("./fixtures/pkg/", import.meta.url));
const entryPoints: ReadonlyArray<Extractor.EntryPoint> = [
  { name: "index", file: `${pkgDir}index.ts` },
  { name: "storage/sqlite", file: `${pkgDir}sqlite.ts` },
];

const pkgLayer = Extractor.layer({
  repoRoot: fixturesDir,
  srcDir: pkgDir.slice(0, -1), // no trailing slash on purpose — the layer must normalize it
  slug: "test",
  repoBaseUrl: "",
  repoPathPrefix: "",
  isPublic: (sym, checker) => sym.getJsDocTags(checker).some((t) => t.name === "since"),
}).pipe(
  Layer.provideMerge(TsProgram.layer({ entries: entryPoints.map((e) => e.file), compilerOptions }))
);

describe("Extractor.package", () => {
  it.effect("walks subpath + barrel namespaces and bare exports, sorted", () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor.Extractor;
      const model = yield* extractor.package(entryPoints);
      // (top-level) leads; modules alphabetical after it
      expect(model.map((e) => e.entry)).toStrictEqual(["(top-level)", "storage/sqlite", "Widgets"]);
    }).pipe(Effect.provide(pkgLayer))
  );

  it.effect("prefers the public rename and drops namespaced bare re-exports", () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor.Extractor;
      const model = yield* extractor.package(entryPoints);
      const topLevel = model.find((e) => e.entry === "(top-level)");
      // `internalSpin` is also exported as `spin` -> only `spin` shows; the barrel's bare
      // `makeWidget` re-export is reachable through Widgets -> dropped here
      expect(topLevel?.symbols.map((s) => s.name)).toStrictEqual([
        "assemble",
        "makeGadget",
        "spin",
      ]);
    }).pipe(Effect.provide(pkgLayer))
  );

  it.effect("groups a barrel `export * as` module and slugs a subpath entry", () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor.Extractor;
      const model = yield* extractor.package(entryPoints);
      const widgets = model.find((e) => e.entry === "Widgets");
      expect(widgets?.symbols.map((s) => s.name)).toStrictEqual(["makeWidget", "Widget"]);
      expect(widgets?.symbols.map((s) => s.kind)).toStrictEqual(["const", "interface"]);
      expect(widgets?.symbols.map((s) => s.source.file)).toStrictEqual([
        "pkg/widgets.ts",
        "pkg/widgets.ts",
      ]);
      const sqlite = model.find((e) => e.entry === "storage/sqlite");
      expect(sqlite?.symbols.map((s) => s.url)).toStrictEqual(["/api/test/storage-sqlite/open"]);
    }).pipe(Effect.provide(pkgLayer))
  );

  it.effect("fills docLinks from {@link} via compiler resolution (per-package)", () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor.Extractor;
      const model = yield* extractor.package(entryPoints);
      const widgets = model.find((e) => e.entry === "Widgets");
      const makeWidget = widgets?.symbols.find((s) => s.name === "makeWidget");
      expect(makeWidget?.linkTargets).toStrictEqual(["Widget"]);
      expect(makeWidget?.docLinks).toStrictEqual({ Widget: "/api/test/Widgets/Widget" });
      const widget = widgets?.symbols.find((s) => s.name === "Widget");
      expect(widget?.docLinks).toStrictEqual({});
    }).pipe(Effect.provide(pkgLayer))
  );

  it.effect("does not link a {@link} to the symbol's own parameter", () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor.Extractor;
      const model = yield* extractor.package(entryPoints);
      const topLevel = model.find((e) => e.entry === "(top-level)");
      const assemble = topLevel?.symbols.find((s) => s.name === "assemble");
      // `{@link parts}` names `assemble`'s parameter — declared on `assemble`'s own line, so a
      // line-keyed lookup would hand back assemble's page; it must be dropped instead
      expect(assemble?.linkTargets).toStrictEqual(["parts", "makeGadget"]);
      expect(assemble?.docLinks).toStrictEqual({
        makeGadget: "/api/test/top-level/makeGadget",
      });
    }).pipe(Effect.provide(pkgLayer))
  );
});
