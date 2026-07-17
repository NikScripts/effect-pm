/**
 * Extracts one documented export into a {@link Model.Symbol} — signatures resolved THROUGH the checker
 * (so inferred return types are captured), the real source cut verbatim from the file, kind, tags, and
 * the "view source" URL. A function of the checker, no IO.
 *
 * Scope note: this is per-symbol extraction (gen-api's `toApi`). The module walk that FINDS the symbols
 * (`export * as` namespaces, subpath entries, `preferRename`) and the second-pass `{@link}` resolution
 * (which reuses {@link LinkResolver} once every symbol has a URL) are the remaining Extractor work —
 * see docs/handoffs/docgen-system-design.md, Phase 3.
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as nodePath from "node:path";
import prettier from "prettier";
import ts from "typescript";
import * as Model from "./Model.js";
import { slugForEntry } from "./Slug.js";
import * as TsProgram from "./TsProgram.js";

const TypeId = "~docgen/Extractor";

// Alias-preserving format: keep named types (`Layer.Layer<…>`) instead of expanding their structure.
const formatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteTypeArgumentsOfSignature |
  ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType |
  ts.TypeFormatFlags.WriteArrayAsGenericType;

// typeToString emits `import("/abs/path").Name` — strip the import() wrapper.
const strip = (text: string): string =>
  text.replace(/import\("[^"]*"\)\./g, "").replace(/\s*\n\s*/g, " ");

// Display formatting via Prettier: the checker emits one long line, so wrap in a valid TS construct,
// format so long overloads break across lines, and unwrap. Best-effort — unparseable text is kept.
const prettierOptions = { parser: "typescript" as const, printWidth: 76, semi: false };
const formatSignature = (sig: string): string => {
  try {
    return prettier
      .format(`interface _ {\n${sig}\n}`, prettierOptions)
      .trim()
      .replace(/^interface _ \{\n?/, "")
      .replace(/\n?\}$/, "")
      .replace(/^ {2}/gm, "")
      .trim();
  } catch {
    return sig;
  }
};
const formatType = (type: string): string => {
  try {
    return prettier
      .format(`type _ = ${type}\n`, prettierOptions)
      .trim()
      .replace(/^type _ =\s*/, "")
      .replace(/;\s*$/, "")
      .trim();
  } catch {
    return type;
  }
};

const kindOf = (sym: ts.Symbol): string => {
  const f = sym.flags;
  if ((f & ts.SymbolFlags.Function) !== 0) return "function";
  if ((f & ts.SymbolFlags.Class) !== 0) return "class";
  if ((f & ts.SymbolFlags.Interface) !== 0) return "interface";
  if ((f & ts.SymbolFlags.TypeAlias) !== 0) return "type";
  if ((f & ts.SymbolFlags.Namespace) !== 0) return "namespace";
  if ((f & (ts.SymbolFlags.Variable | ts.SymbolFlags.BlockScopedVariable)) !== 0) return "const";
  return "value";
};

// A `const`/`let` keyword lives on the enclosing statement — climb to it so the source span is whole.
const declNode = (decl: ts.Declaration): ts.Node =>
  ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)
    ? decl.parent.parent
    : decl;

const rawCommentOf = (decl: ts.Declaration): string => {
  const jsdoc = ts.getJSDocCommentsAndTags(decl).filter(ts.isJSDoc);
  return jsdoc.length > 0 ? jsdoc[jsdoc.length - 1].getText() : "";
};

/**
 * Per-symbol extraction into the {@link Model}.
 *
 * @category models
 * @since 1.0.0
 */
export interface Extractor {
  readonly [TypeId]: typeof TypeId;
  /**
   * Extract one export reached through `namespace` (none = a bare top-level export). None when the
   * symbol isn't documented by this package (defined elsewhere, or not public per {@link Options}).
   */
  readonly symbol: (
    namespace: Option.Option<string>,
    exportSymbol: ts.Symbol
  ) => Option.Option<Model.Symbol>;
}

/**
 * The `Extractor` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const Extractor: Context.Service<Extractor, Extractor> = Context.Service("docgen/Extractor");

/**
 * Options for {@link layer}: which declarations count (`srcDir` + `isPublic`), the URL scheme (`slug`),
 * and the "view source" base (`repoBaseUrl` / `repoPathPrefix`, both relative to `repoRoot`).
 *
 * @category models
 * @since 1.0.0
 */
export interface Options {
  readonly repoRoot: string;
  /** Absolute, trailing slash — only symbols DECLARED under here are documented by this package. */
  readonly srcDir: string;
  /** URL segment: `/api/<slug>/…`. */
  readonly slug: string;
  /** GitHub blob base for "view source" (`""` = no source links). */
  readonly repoBaseUrl: string;
  /** Stripped from the repo-relative file for the GitHub URL. */
  readonly repoPathPrefix: string;
  /** Whether a symbol is part of the public API (e.g. tagged `@category`/`@since`, or `@public`). */
  readonly isPublic: (symbol: ts.Symbol, checker: ts.TypeChecker) => boolean;
}

const makeSymbol = (
  checker: ts.TypeChecker,
  options: Options,
  namespace: Option.Option<string>,
  exportSymbol: ts.Symbol
): Option.Option<Model.Symbol> => {
  const symbol =
    (exportSymbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(exportSymbol)
      : exportSymbol;
  const decl = symbol.getDeclarations()?.[0];
  if (decl === undefined) return Option.none();
  // Only document what THIS package defines — a re-export resolving into a dependency belongs there.
  if (!decl.getSourceFile().fileName.startsWith(options.srcDir)) return Option.none();
  if (!options.isPublic(symbol, checker)) return Option.none();

  const isType =
    (symbol.flags &
      (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) !==
    0;
  const type = isType
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : checker.getTypeOfSymbolAtLocation(symbol, decl);

  const signatures = type
    .getCallSignatures()
    .map((sig) =>
      formatSignature(
        strip(checker.signatureToString(sig, decl, formatFlags, ts.SignatureKind.Call))
      )
    );
  const fullType = strip(checker.typeToString(type, decl, formatFlags));
  const typeText = signatures.length > 0 ? undefined : formatType(fullType);

  const tags = symbol.getJsDocTags(checker).map(
    (tag): Model.Tag => ({
      name: tag.name,
      text: ts.displayPartsToString(tag.text ?? []),
    })
  );

  const source = decl.getSourceFile();
  const nodes = (symbol.getDeclarations() ?? [])
    .filter((d) => d.getSourceFile().fileName === source.fileName)
    .map(declNode);
  const spanStart = Math.min(...nodes.map((n) => n.getStart()));
  const spanEnd = Math.max(...nodes.map((n) => n.getEnd()));
  const sourceText = nodes.length > 0 ? source.text.slice(spanStart, spanEnd) : "";
  const sourceLine = source.getLineAndCharacterOfPosition(spanStart).line + 1;
  const rawComment = rawCommentOf(decl);
  const name = exportSymbol.getName();
  const entry = Option.getOrElse(namespace, () => "(top-level)");
  const qualifiedName = Option.match(namespace, {
    onNone: () => name,
    onSome: (ns) => `${ns}.${name}`,
  });
  const relFile = nodePath.relative(options.repoRoot, source.fileName);
  const sourceUrl =
    options.repoBaseUrl !== ""
      ? `${options.repoBaseUrl}/${
          relFile.startsWith(options.repoPathPrefix)
            ? relFile.slice(options.repoPathPrefix.length)
            : relFile
        }#L${sourceLine}`
      : undefined;

  return Option.some({
    entry,
    name,
    qualifiedName,
    url: `/api/${options.slug}/${slugForEntry(entry)}/${name}`,
    kind: kindOf(symbol),
    signatures,
    typeText,
    sourceText,
    summary: strip(ts.displayPartsToString(symbol.getDocumentationComment(checker))),
    rawComment,
    tags,
    category: tags.find((tag) => tag.name === "category")?.text,
    linkTargets: [...new Set([...rawComment.matchAll(/\{@link\s+([^}|\s]+)/g)].map((m) => m[1]))],
    docLinks: {}, // filled by the {@link} second pass once every symbol has a URL
    source: { file: relFile, line: sourceLine, url: sourceUrl },
  });
};

/**
 * An {@link Extractor} over the current {@link TsProgram}.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer = (options: Options): Layer.Layer<Extractor, never, TsProgram.TsProgram> =>
  Layer.effect(Extractor)(
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      return {
        [TypeId]: TypeId,
        symbol: (namespace, exportSymbol) =>
          makeSymbol(program.checker, options, namespace, exportSymbol),
      };
    })
  );
