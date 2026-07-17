import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as LinkResolver from "../../src/docgen/LinkResolver.js";
import * as SymbolIndex from "../../src/docgen/SymbolIndex.js";
import * as TsProgram from "../../src/docgen/TsProgram.js";

const fixture = fileURLToPath(new URL("./fixtures/resolve-fixture.ts", import.meta.url));
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

// `Target` is declared on line 1 of the fixture (see resolve-fixture.ts).
const withTarget = SymbolIndex.layer([
  { file: "resolve-fixture.ts", line: 1, url: "/api/test/Target" },
]);
const empty = SymbolIndex.layer([]);

// the identifier of the first `<name>` type reference in the source (throws if absent — a broken test)
const findRef = (sf: ts.SourceFile, name: string): ts.Node => {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isTypeReferenceNode(node)) {
      const id = ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName;
      if (id.getText() === name) {
        found = id;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  if (found === undefined) throw new Error(`no type reference '${name}' in fixture`);
  return found;
};

// the identifier of the first `<name>.…` property access in the source (a value USE, not a type)
const findUsage = (sf: ts.SourceFile, name: string): ts.Node => {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = node.expression;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sf);
  if (found === undefined) throw new Error(`no usage of '${name}' in fixture`);
  return found;
};

const provided = (index: Layer.Layer<SymbolIndex.SymbolIndex>) =>
  LinkResolver.layer({ repoRoot }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(TsProgram.layer({ entries: [fixture], compilerOptions }), index)
    )
  );

describe("LinkResolver", () => {
  it.effect("resolves a documented type reference to its url", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const resolver = yield* LinkResolver.LinkResolver;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      const ref = findRef(sf, "Target");

      expect(resolver.resolve(ref)).toStrictEqual(Option.some("/api/test/Target"));
    }).pipe(Effect.provide(provided(withTarget)))
  );

  it.effect("returns none for a type parameter (local, no page)", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const resolver = yield* LinkResolver.LinkResolver;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      const ref = findRef(sf, "A"); // Holder<A>'s `value: A`

      expect(Option.isNone(resolver.resolve(ref))).toBe(true);
    }).pipe(Effect.provide(provided(withTarget)))
  );

  it.effect("returns none when the target is not in the index (undocumented)", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const resolver = yield* LinkResolver.LinkResolver;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      const ref = findRef(sf, "Target");
      expect(Option.isNone(resolver.resolve(ref))).toBe(true);
    }).pipe(Effect.provide(provided(empty)))
  );

  it.effect("returns none for a parameter even when its line is indexed", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const resolver = yield* LinkResolver.LinkResolver;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      // `holder.target` in the body of `use` — the parameter is declared on the SAME line the
      // index maps to `use`'s page; a parameter must not resolve to it
      const ref = findUsage(sf, "holder");
      expect(Option.isNone(resolver.resolve(ref))).toBe(true);
    }).pipe(
      Effect.provide(
        provided(SymbolIndex.layer([{ file: "resolve-fixture.ts", line: 8, url: "/api/test/use" }]))
      )
    )
  );
});
