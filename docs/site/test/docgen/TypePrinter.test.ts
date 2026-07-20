import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as LinkResolver from "@nikscripts/docgen/LinkResolver";
import * as SymbolIndex from "@nikscripts/docgen/SymbolIndex";
import * as TsProgram from "@nikscripts/docgen/TsProgram";
import * as TypePrinter from "@nikscripts/docgen/TypePrinter";

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

const provided = TypePrinter.layer.pipe(
  Layer.provideMerge(LinkResolver.layer({ repoRoot })),
  Layer.provideMerge(
    Layer.mergeAll(TsProgram.layer({ entries: [fixture], compilerOptions }), index)
  )
);

// A two-file program for the home-retry test: `Target` is declared (and indexed) in home-lib.ts
// and NOT in scope in home-user.ts.
const providedHome = TypePrinter.layer.pipe(
  Layer.provideMerge(LinkResolver.layer({ repoRoot })),
  Layer.provideMerge(
    Layer.mergeAll(
      TsProgram.layer({
        entries: [
          fileURLToPath(new URL("./fixtures/home-lib.ts", import.meta.url)),
          fileURLToPath(new URL("./fixtures/home-user.ts", import.meta.url)),
        ],
        compilerOptions,
      }),
      SymbolIndex.layer([
        {
          file: "home-lib.ts",
          line: 1,
          url: "/api/test/Target",
        },
      ])
    )
  )
);

// The checker type of a fixture export at its declaration (throws if absent — a broken test).
const exportType = (
  program: TsProgram.TsProgram,
  name: string
): { readonly type: ts.Type; readonly decl: ts.Declaration } => {
  const sf = Option.getOrThrow(program.sourceFile(fixture));
  const moduleSymbol = program.checker.getSymbolAtLocation(sf);
  if (moduleSymbol === undefined) throw new Error("no module symbol for the fixture");
  const symbol = program.checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === name);
  if (symbol === undefined) throw new Error(`no export '${name}' in fixture`);
  const decl = symbol.getDeclarations()?.[0];
  if (decl === undefined) throw new Error(`no declaration for '${name}'`);
  return {
    type: program.checker.getTypeOfSymbolAtLocation(symbol, decl),
    decl,
  };
};

// The first `<name>` type reference NODE in the source (throws if absent — a broken test).
const findRefNode = (sf: ts.SourceFile, name: string): ts.TypeNode => {
  let found: ts.TypeNode | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isTypeReferenceNode(node)) {
      const id = ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName;
      if (id.getText() === name) {
        found = node;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  if (found === undefined) throw new Error(`no type reference '${name}' in fixture`);
  return found;
};

const textOf = (parts: ReadonlyArray<TypePrinter.Part>): string =>
  parts.map((part) => part.text).join("");

const linksOf = (parts: ReadonlyArray<TypePrinter.Part>): ReadonlyArray<[string, string]> =>
  parts.flatMap((part) =>
    Option.match(part.url, {
      onNone: (): ReadonlyArray<[string, string]> => [],
      onSome: (url): ReadonlyArray<[string, string]> => [[part.text, url]],
    })
  );

describe("TypePrinter", () => {
  it.effect("prints a function type with every documented reference linked", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const { decl, type } = exportType(program, "use");

      expect(printer.printType(type, decl)).toStrictEqual([
        {
          text: "(holder: ",
          url: Option.none(),
        },
        {
          text: "Holder",
          url: Option.some("/api/test/Holder"),
        },
        {
          text: "<",
          url: Option.none(),
        },
        {
          text: "Target",
          url: Option.some("/api/test/Target"),
        },
        {
          text: ">) => ",
          url: Option.none(),
        },
        {
          text: "Target",
          url: Option.some("/api/test/Target"),
        },
      ]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("prints a union, linking only the documented member", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const { decl, type } = exportType(program, "pick");
      const parts = printer.printType(type, decl);

      expect(textOf(parts)).toBe("(flag: boolean) => Target | undefined");
      expect(linksOf(parts)).toStrictEqual([["Target", "/api/test/Target"]]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("keeps type parameters plain (local, no page)", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const { decl, type } = exportType(program, "identity");
      const parts = printer.printType(type, decl);

      expect(textOf(parts)).toBe("<A>(value: A) => A");
      expect(linksOf(parts)).toStrictEqual([]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("links inside a built-in generic without linking the built-in", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const { decl, type } = exportType(program, "targets");
      const parts = printer.printType(type, decl);

      expect(textOf(parts)).toBe("() => ReadonlyArray<Target>");
      expect(linksOf(parts)).toStrictEqual([["Target", "/api/test/Target"]]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("falls back to plain printer text for an unhandled kind (mapped type)", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const { decl, type } = exportType(program, "remap");
      const parts = printer.printType(type, decl);

      expect(textOf(parts)).toMatch(/^<T>\(value: T\) => \{/);
      expect(textOf(parts)).toContain("K in keyof T");
      expect(linksOf(parts)).toStrictEqual([]);
    }).pipe(Effect.provide(provided))
  );

  it.effect("home-retry: links land even from an enclosing scope that lacks the names", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const lib = fileURLToPath(new URL("./fixtures/home-lib.ts", import.meta.url));
      const user = fileURLToPath(new URL("./fixtures/home-user.ts", import.meta.url));
      const libSf = Option.getOrThrow(program.sourceFile(lib));
      const userSf = Option.getOrThrow(program.sourceFile(user));
      const moduleSymbol = program.checker.getSymbolAtLocation(libSf);
      if (moduleSymbol === undefined) throw new Error("no module symbol for home-lib");
      const makeSymbol = program.checker
        .getExportsOfModule(moduleSymbol)
        .find((s) => s.getName() === "make");
      const decl = makeSymbol?.getDeclarations()?.[0];
      if (makeSymbol === undefined || decl === undefined) throw new Error("no make in home-lib");
      const type = program.checker.getTypeOfSymbolAtLocation(makeSymbol, decl);
      // Print at a node in home-user.ts, where `Target` is NOT in scope — the home retry must
      // recover the reference from the type's own declaration scope.
      const foreign = userSf.statements[0];
      if (foreign === undefined) throw new Error("no statement in home-user");
      const parts = printer.printType(type, foreign);

      expect(
        linksOf(parts).some(([text, url]) => text.includes("Target") && url === "/api/test/Target")
      ).toBe(true);
    }).pipe(Effect.provide(providedHome))
  );

  it.effect("prints a parsed source annotation node with links", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const printer = yield* TypePrinter.TypePrinter;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      const parts = printer.printNode(findRefNode(sf, "Holder"));

      expect(textOf(parts)).toBe("Holder<Target>");
      expect(linksOf(parts)).toStrictEqual([
        ["Holder", "/api/test/Holder"],
        ["Target", "/api/test/Target"],
      ]);
    }).pipe(Effect.provide(provided))
  );
});
