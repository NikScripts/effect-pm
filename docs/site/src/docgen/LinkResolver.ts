/**
 * Compiler-accurate link resolution — the IDE's "go to definition", not name-matching. Given an
 * identifier node, resolve it to the EXACT symbol it references (through aliases, imports, scope) and
 * map that symbol's declaration back to its doc URL via the {@link SymbolIndex}. Cross-module and
 * colliding names (`Array`, `Error`) and a module's own type all resolve correctly — the checker
 * already did the work the name-heuristic could only guess at.
 *
 * Returns none — by nature, not failure — for type parameters (local, no page), built-ins
 * (`string`, `Exclude` — lib.d.ts), and symbols outside the documented set.
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as nodePath from "node:path";
import ts from "typescript";
import * as SymbolIndex from "./SymbolIndex.js";
import * as TsProgram from "./TsProgram.js";

const TypeId = "~docgen/LinkResolver";

/**
 * Resolves an identifier node to the doc URL of the symbol it references.
 *
 * @category models
 * @since 1.0.0
 */
export interface LinkResolver {
  readonly [TypeId]: typeof TypeId;
  /** The doc URL the identifier at `node` points at, or none. */
  readonly resolve: (node: ts.Node) => Option.Option<string>;
  /**
   * The doc URL of a symbol already in hand (aliases resolved, same declaration-site rules) — for
   * callers that know the symbol without a resolvable node, e.g. a checker type's own symbol.
   */
  readonly resolveSymbol: (symbol: ts.Symbol) => Option.Option<string>;
}

/**
 * The `LinkResolver` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const LinkResolver: Context.Service<LinkResolver, LinkResolver> =
  Context.Service("docgen/LinkResolver");

/**
 * Options for {@link layer}: `repoRoot` makes a resolved declaration's absolute path repo-relative, to
 * match the {@link SymbolIndex.Entry} keys (the model records repo-relative paths).
 *
 * @category models
 * @since 1.0.0
 */
export interface Options {
  readonly repoRoot: string;
}

// A variable declaration's `const`/`export` keyword lives on the enclosing statement, so climb to it —
// that's the line the model recorded (the extractor uses the same rule).
const declNode = (decl: ts.Declaration): ts.Node =>
  ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)
    ? decl.parent.parent
    : decl;

// Only an export-shaped declaration can carry a doc page: after the climb it must sit directly in a
// source file (or a `namespace` block). A parameter, local, or member shares its STATEMENT's line —
// `export const rollup = (byNode: …)` puts `byNode` on `rollup`'s line — and a line-keyed lookup
// would hand back the enclosing export's page for it; a symbol-keyed map never would, so skip them.
const isDeclarationSite = (owner: ts.Node): boolean =>
  !ts.isSourceFile(owner) && (ts.isSourceFile(owner.parent) || ts.isModuleBlock(owner.parent));

const resolveSymbolWith = (
  checker: ts.TypeChecker,
  index: SymbolIndex.SymbolIndex,
  repoRoot: string
): ((symbol: ts.Symbol) => Option.Option<string>) => {
  return (initial) => {
    const symbol =
      (initial.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(initial) : initial;
    // Type parameters resolve to their `<A>` declaration (inside some symbol's span) but are local
    // placeholders with no page — skip, else `Layer<ROut, E>`'s params would link to Layer itself.
    if ((symbol.flags & ts.SymbolFlags.TypeParameter) !== 0) return Option.none();
    for (const decl of symbol.getDeclarations() ?? []) {
      const owner = declNode(decl);
      if (!isDeclarationSite(owner)) continue;
      const source = owner.getSourceFile();
      const rel = nodePath.relative(repoRoot, source.fileName);
      const line = source.getLineAndCharacterOfPosition(owner.getStart()).line + 1;
      const url = index.urlAt(rel, line);
      if (Option.isSome(url)) return url;
    }
    return Option.none();
  };
};

const resolveWith = (
  checker: ts.TypeChecker,
  resolveSymbol: (symbol: ts.Symbol) => Option.Option<string>
): ((node: ts.Node) => Option.Option<string>) => {
  return (node) => {
    const initial = checker.getSymbolAtLocation(node);
    if (initial === undefined) return Option.none();
    return resolveSymbol(initial);
  };
};

/**
 * A {@link LinkResolver} over the current {@link TsProgram} and {@link SymbolIndex}.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer = (
  options: Options
): Layer.Layer<LinkResolver, never, TsProgram.TsProgram | SymbolIndex.SymbolIndex> =>
  Layer.effect(LinkResolver)(
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const index = yield* SymbolIndex.SymbolIndex;
      const resolveSymbol = resolveSymbolWith(program.checker, index, options.repoRoot);
      return {
        [TypeId]: TypeId,
        resolve: resolveWith(program.checker, resolveSymbol),
        resolveSymbol,
      };
    })
  );
