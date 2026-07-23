/**
 * Extracts documented exports into the {@link Model} — signatures resolved THROUGH the checker
 * (so inferred return types are captured), the real source cut verbatim from the file, kind, tags, and
 * the "view source" URL. A function of the checker, no IO.
 *
 * Two granularities: `symbol` extracts one export (gen-api's `toApi`); `package` walks the entry
 * points (subpath namespaces, the barrel's `export * as` modules, genuinely top-level bare exports),
 * extracts every public symbol, and then resolves each symbol's JSDoc `{@link}` targets through the
 * {@link LinkResolver} — against the package's OWN symbols only, matching gen-api's per-package map,
 * so the model diffs byte-identical. Cross-package linking is a deliberate post-gate enhancement.
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
import * as LinkResolver from "./LinkResolver.js";
import * as Model from "./Model.js";
import { slugForEntry } from "./Slug.js";
import * as SymbolIndex from "./SymbolIndex.js";
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
const prettierOptions = {
  parser: "typescript" as const,
  printWidth: 76,
  semi: false,
};
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

// Re-exports (`export { x } from "./y"`) arrive as Alias symbols carrying no docs of their own —
// resolve to the real symbol before reading anything.
const resolveAlias = (checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol =>
  (sym.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(sym)
    : sym;

const kindOf = (sym: ts.Symbol): string => {
  const f = sym.flags;
  if ((f & ts.SymbolFlags.Function) !== 0) return "function";
  if ((f & ts.SymbolFlags.Class) !== 0) return "class";
  if ((f & ts.SymbolFlags.Interface) !== 0) return "interface";
  if ((f & ts.SymbolFlags.TypeAlias) !== 0) return "type";
  if ((f & ts.SymbolFlags.Namespace) !== 0) return "namespace";
  if (
    (f & (ts.SymbolFlags.Variable | ts.SymbolFlags.BlockScopedVariable)) !==
    0
  )
    return "const";
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
  /**
   * Extract a whole package from its entry points: walk the namespaces, extract every public symbol,
   * then fill each symbol's `docLinks` by resolving its JSDoc `{@link}` targets against the package's
   * own symbols (a per-package index — a `{@link}` into another package resolves to none).
   */
  readonly package: (
    entryPoints: ReadonlyArray<EntryPoint>
  ) => Effect.Effect<ReadonlyArray<Model.Entry>>;
}

/**
 * The `Extractor` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const Extractor: Context.Service<Extractor, Extractor> =
  Context.Service("docgen/Extractor");

/**
 * A program entry point — the export name it is reached by (`"index"` names the barrel) and its
 * absolute source file. Mirrors the `package.json` `exports`-derived list the generator builds.
 *
 * @category models
 * @since 1.0.0
 */
export interface EntryPoint {
  readonly name: string;
  readonly file: string;
}

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

// One extracted symbol plus the compiler handles it came from — the `{@link}` second pass walks the
// declaration's JSDoc and keys the URL index by the RESOLVED symbol, so the walk keeps all three
// internally; only the model is public.
interface Extracted {
  readonly model: Model.Symbol;
  readonly decl: ts.Declaration;
  readonly symbol: ts.Symbol;
}

const makeSymbol = (
  checker: ts.TypeChecker,
  options: Options,
  namespace: Option.Option<string>,
  exportSymbol: ts.Symbol
): Option.Option<Extracted> => {
  const symbol = resolveAlias(checker, exportSymbol);
  const decl = symbol.getDeclarations()?.[0];
  if (decl === undefined) return Option.none();
  // Only document what THIS package defines — a re-export resolving into a dependency belongs there.
  if (!decl.getSourceFile().fileName.startsWith(options.srcDir))
    return Option.none();
  if (!options.isPublic(symbol, checker)) return Option.none();

  const isType =
    (symbol.flags &
      (ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Interface |
        ts.SymbolFlags.Class)) !==
    0;
  const type = isType
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : checker.getTypeOfSymbolAtLocation(symbol, decl);

  const signatures = type
    .getCallSignatures()
    .map((sig) =>
      formatSignature(
        strip(
          checker.signatureToString(
            sig,
            decl,
            formatFlags,
            ts.SignatureKind.Call
          )
        )
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
  // `decl` itself is declared in `source`, so `nodes` is never empty and the span is well-defined.
  const nodes = (symbol.getDeclarations() ?? [])
    .filter((d) => d.getSourceFile().fileName === source.fileName)
    .map(declNode);
  const spanStart = Math.min(...nodes.map((n) => n.getStart()));
  const spanEnd = Math.max(...nodes.map((n) => n.getEnd()));
  const sourceText = source.text.slice(spanStart, spanEnd);
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
    model: {
      entry,
      name,
      qualifiedName,
      url: `/api/${options.slug}/${slugForEntry(entry)}/${name}`,
      kind: kindOf(symbol),
      signatures,
      typeText,
      sourceText,
      summary: strip(
        ts.displayPartsToString(symbol.getDocumentationComment(checker))
      ),
      rawComment,
      tags,
      category: tags.find((tag) => tag.name === "category")?.text,
      linkTargets: [
        ...new Set(
          [...rawComment.matchAll(/\{@link\s+([^}|\s]+)/g)].map((m) => m[1])
        ),
      ],
      docLinks: {}, // filled by the {@link} second pass once every symbol has a URL
      source: {
        file: relFile,
        line: sourceLine,
        url: sourceUrl,
      },
    },
    decl,
    symbol,
  });
};

// `export * as X` / a subpath module resolves to a symbol whose declaration IS a source file.
const isModuleSymbol = (sym: ts.Symbol): boolean =>
  (sym.getDeclarations() ?? []).some((d) => ts.isSourceFile(d));

// A symbol can be exported under several names — its internal name AND an `export { x as Public }`
// rename (e.g. `customQueueTag` and `… as Tag`). Show only the PUBLIC rename a caller is meant to
// use, never a second entry under the internal name.
const preferRename = (
  checker: ts.TypeChecker,
  exports: ReadonlyArray<ts.Symbol>
): ReadonlyArray<ts.Symbol> => {
  const byResolved = new Map<ts.Symbol, Array<ts.Symbol>>();
  for (const exportSymbol of exports) {
    const resolved = resolveAlias(checker, exportSymbol);
    const seen = byResolved.get(resolved);
    if (seen === undefined) byResolved.set(resolved, [exportSymbol]);
    else seen.push(exportSymbol);
  }
  return [...byResolved].map(
    ([resolved, candidates]) =>
      candidates.find((c) => c.getName() !== resolved.getName()) ??
      candidates[0]
  );
};

// The walk that FINDS the symbols: namespace groups = every subpath entry (its own `import * as`
// namespace) PLUS any barrel `export * as NS` whose module has no subpath of its own; whatever the
// barrel exports bare AND isn't reachable through a namespace is genuinely top-level.
interface Walked {
  readonly entries: ReadonlyArray<{
    readonly entry: string;
    /** First paragraph of the module's `@module` header ("" when absent). */
    readonly summary: string;
    readonly symbols: ReadonlyArray<Extracted>;
  }>;
  /**
   * One location per RESOLVED symbol, in extraction order (groups first, top-level last) with the
   * LAST extraction winning — a symbol re-exported under two namespaces (`Predicate.isTupleOf` and
   * `Tuple.isTupleOf`) has two pages but one declaration line, and gen-api's symbol-keyed map
   * resolves `{@link}`s to the page extracted last. Keying per symbol reproduces that; feeding raw
   * per-page entries would make every such location ambiguous and drop the links.
   */
  readonly locations: ReadonlyArray<SymbolIndex.Entry>;
}

const walkPackage = (
  program: TsProgram.TsProgram,
  options: Options,
  entryPoints: ReadonlyArray<EntryPoint>
): Walked => {
  const checker = program.checker;
  const moduleOf = (file: string): Option.Option<ts.Symbol> =>
    Option.flatMap(program.sourceFile(file), (sf) =>
      Option.fromNullishOr(checker.getSymbolAtLocation(sf))
    );

  const barrel = entryPoints.find((e) => e.name === "index");
  const barrelModule =
    barrel === undefined ? Option.none<ts.Symbol>() : moduleOf(barrel.file);
  const subpathFiles = new Set(entryPoints.map((e) => e.file));
  const groups: Array<{
    readonly ns: string;
    readonly module: ts.Symbol;
  }> = [];
  for (const entryPoint of entryPoints) {
    if (entryPoint.name === "index") continue;
    Option.match(moduleOf(entryPoint.file), {
      onNone: () => {},
      onSome: (module) => groups.push({ ns: entryPoint.name, module }),
    });
  }
  if (Option.isSome(barrelModule)) {
    for (const exportSymbol of checker.getExportsOfModule(barrelModule.value)) {
      const resolved = resolveAlias(checker, exportSymbol);
      const decl = resolved.getDeclarations()?.[0];
      if (
        decl !== undefined &&
        ts.isSourceFile(decl) &&
        !subpathFiles.has(decl.fileName)
      ) {
        groups.push({ ns: exportSymbol.getName(), module: resolved });
      }
    }
  }

  // Nested namespaces: a group module re-exporting a whole module (`export * as sub from
  // "./Sub"`) surfaces as a dotted child group ("Owner.sub") — unless the target already has a
  // page of its own (a subpath or another group), which keeps one page per module. One level
  // deep: the snapshot iterates only the groups found above.
  const groupModules = new Set(groups.map((g) => g.module));
  for (const group of [...groups]) {
    for (const member of checker.getExportsOfModule(group.module)) {
      const resolved = resolveAlias(checker, member);
      const decl = resolved.getDeclarations()?.[0];
      if (
        decl !== undefined &&
        ts.isSourceFile(decl) &&
        !subpathFiles.has(decl.fileName) &&
        !groupModules.has(resolved)
      ) {
        groups.push({ ns: `${group.ns}.${member.getName()}`, module: resolved });
        groupModules.add(resolved);
      }
    }
  }

  // Every symbol reachable through a namespace — the barrel's bare re-exports of those are dropped
  // (shown once, under their namespace); only genuinely top-level bare exports remain.
  const namespaced = new Set<ts.Symbol>();
  for (const group of groups) {
    for (const member of checker.getExportsOfModule(group.module)) {
      namespaced.add(resolveAlias(checker, member));
    }
  }

  const extract =
    (namespace: Option.Option<string>) =>
    (exportSymbol: ts.Symbol): ReadonlyArray<Extracted> =>
      Option.match(makeSymbol(checker, options, namespace, exportSymbol), {
        onNone: () => [],
        onSome: (extracted) => [extracted],
      });
  const byName = (a: Extracted, b: Extracted): number =>
    a.model.name.localeCompare(b.model.name);

  // The module's own one-liner: first paragraph of the source file's leading /** */ header
  // (the `@module` doc). Same zero-guess rule as everything else — no header, no summary.
  const moduleSummary = (module: ts.Symbol): string => {
    const decl = module.getDeclarations()?.[0];
    if (decl === undefined || !ts.isSourceFile(decl)) return "";
    const full = decl.getFullText();
    const ranges = ts.getLeadingCommentRanges(full, 0) ?? [];
    for (const range of ranges) {
      const text = full.slice(range.pos, range.end);
      if (!text.startsWith("/**")) continue;
      const lines = text
        .split("\n")
        .map((line) => line.replace(/^\s*\/?\*+\/?\s?/, "").trimEnd());
      const body: Array<string> = [];
      for (const line of lines) {
        if (line.startsWith("@")) break;
        if (line.trim() === "") {
          if (body.length > 0) break;
          continue;
        }
        body.push(line.trim());
      }
      if (body.length > 0) return body.join(" ");
    }
    return "";
  };

  const nsEntries = groups.map((group) => ({
    entry: group.ns,
    summary: moduleSummary(group.module),
    symbols: preferRename(checker, checker.getExportsOfModule(group.module))
      .flatMap(extract(Option.some(group.ns)))
      .sort(byName),
  }));
  const topLevel = Option.match(barrelModule, {
    onNone: (): ReadonlyArray<Extracted> => [],
    onSome: (module) =>
      preferRename(checker, checker.getExportsOfModule(module))
        .filter(
          (exportSymbol) =>
            !isModuleSymbol(resolveAlias(checker, exportSymbol)) &&
            !namespaced.has(resolveAlias(checker, exportSymbol))
        )
        .flatMap(extract(Option.none()))
        .sort(byName),
  });

  const ordered = [
    ...nsEntries,
    {
      entry: "(top-level)",
      summary: "",
      symbols: topLevel,
    },
  ];
  const bySymbol = new Map<ts.Symbol, SymbolIndex.Entry>();
  for (const entry of ordered) {
    for (const { model, symbol } of entry.symbols) {
      bySymbol.set(symbol, {
        file: model.source.file,
        line: model.source.line,
        url: model.url,
      });
    }
  }

  return {
    entries: ordered
      .filter((e) => e.symbols.length > 0)
      // Modules list alphabetically; bare top-level exports lead.
      .sort((a, b) =>
        a.entry === "(top-level)"
          ? -1
          : b.entry === "(top-level)"
          ? 1
          : a.entry.localeCompare(b.entry)
      ),
    locations: [...bySymbol.values()],
  };
};

// Resolve one extracted symbol's JSDoc {@link} targets through the LinkResolver — the compiler picks
// the exact symbol, so bare names disambiguate by context (`layer` inside WorkPool's docs is
// WorkPool.layer). Runs AFTER extraction, once every symbol in the package has a URL.
const docLinksOf = (
  resolver: LinkResolver.LinkResolver,
  decl: ts.Declaration
): Record<string, string> => {
  const out: Record<string, string> = {};
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJSDocLink(node) ||
        ts.isJSDocLinkCode(node) ||
        ts.isJSDocLinkPlain(node)) &&
      node.name !== undefined
    ) {
      const name = node.name;
      Option.match(resolver.resolve(name), {
        onNone: () => {},
        onSome: (url) => {
          out[name.getText()] = url;
        },
      });
    }
    node.forEachChild(visit);
  };
  for (const jsdoc of ts.getJSDocCommentsAndTags(decl)) visit(jsdoc);
  return out;
};

/**
 * An {@link Extractor} over the current {@link TsProgram}.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer = (
  options: Options
): Layer.Layer<Extractor, never, TsProgram.TsProgram> =>
  Layer.effect(Extractor)(
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      // TS source-file names always use `/`; guarantee the prefix ends with one so `startsWith`
      // can't match a sibling (`…/src2`) of the intended directory.
      const normalized: Options = {
        ...options,
        srcDir: options.srcDir.endsWith("/")
          ? options.srcDir
          : `${options.srcDir}/`,
      };
      const packageModel = (
        entryPoints: ReadonlyArray<EntryPoint>
      ): Effect.Effect<ReadonlyArray<Model.Entry>> => {
        const walked = walkPackage(program, normalized, entryPoints);
        const index = SymbolIndex.layer(walked.locations);
        return LinkResolver.LinkResolver.pipe(
          Effect.map((resolver) =>
            walked.entries.map((entry) => ({
              entry: entry.entry,
              ...(entry.summary !== "" ? { summary: entry.summary } : {}),
              symbols: entry.symbols.map(({ decl, model }) => ({
                ...model,
                docLinks: docLinksOf(resolver, decl),
              })),
            }))
          ),
          Effect.provide(
            LinkResolver.layer({ repoRoot: normalized.repoRoot }).pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(TsProgram.TsProgram)(program),
                  index
                )
              )
            )
          )
        );
      };
      return {
        [TypeId]: TypeId,
        symbol: (namespace, exportSymbol) =>
          Option.map(
            makeSymbol(program.checker, normalized, namespace, exportSymbol),
            (extracted) => extracted.model
          ),
        package: packageModel,
      };
    })
  );
