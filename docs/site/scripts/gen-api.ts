// PROTOTYPE API-reference extractor.
//
// Builds one TS program over the package's entry points (derived from package.json `exports`), walks
// each entry's `@public` exports, and resolves every signature THROUGH THE CHECKER — so inferred
// return types (never written in source) are captured. Emits an `api.json` model the docs site renders
// with its existing Shiki + jsdocToHast. Same checker machinery as docs/site/src/lib/expandType.ts,
// generalised from per-hover to the whole surface.
//
// Per Effect Style the raw node:* touches sit in typed helpers below; the model is a Schema (so the
// JSON round-trips through a codec, not hand-rolled), and every failure is a value in the error channel.
//
//   tsx scripts/gen-api.ts [entryName ...]     (no args = all core entries)

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Config, Console, Data, DateTime, Effect, Exit, Schema } from "effect";
import ts from "typescript";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const packageJsonPath = nodePath.join(repoRoot, "package.json");
const defaultOutPath = nodePath.join(repoRoot, "docs/site/api.json");

// One named error per failure mode (Principles → Errors are values).
class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

// --- the model, as a Schema (single shape for both the JSON codec and the derived types) ---
const ApiTag = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
});
const ApiSymbol = Schema.Struct({
  entry: Schema.String,
  name: Schema.String,
  url: Schema.String,
  kind: Schema.String,
  signatures: Schema.Array(Schema.String), // one per overload (empty for non-callables)
  typeText: Schema.optional(Schema.String), // for non-callable values / type aliases / interfaces
  summary: Schema.String, // resolved doc summary (previews / search)
  rawComment: Schema.String, // raw /** … */ with {@link} intact (the site re-renders this)
  tags: Schema.Array(ApiTag),
  category: Schema.optional(Schema.String),
  linkTargets: Schema.Array(Schema.String), // {@link X} names referenced
  source: Schema.Struct({
    file: Schema.String,
    line: Schema.Number,
  }),
});
const ApiEntry = Schema.Struct({
  entry: Schema.String,
  symbols: Schema.Array(ApiSymbol),
});
const ApiModel = Schema.Struct({
  generated: Schema.String,
  entries: Schema.Array(ApiEntry),
});
type ApiSymbol = Schema.Schema.Type<typeof ApiSymbol>;
type ApiEntry = Schema.Schema.Type<typeof ApiEntry>;
type ApiModel = Schema.Schema.Type<typeof ApiModel>;

interface Entry {
  readonly name: string; // "Resource", "storage/sqlite", "index"
  readonly file: string; // absolute path to src/*.ts
}

// --- isolated node IO — the only raw node:* in the program, behind typed effects ---
const readText = (path: string) =>
  Effect.try({
    try: () => nodeFs.readFileSync(path, "utf8"),
    catch: (cause) => new FileError({ path, cause }),
  });

const writeText = (path: string, text: string) =>
  Effect.try({
    try: () => nodeFs.writeFileSync(path, text),
    catch: (cause) => new FileError({ path, cause }),
  });

// Entry points ARE the public surface — derive them from `exports` (SSOT), mapping the published
// `./dist/X.d.ts` back to its `src/X.ts`. UI entries (web/cli/tui) pull JSX/browser libs, so the
// prototype skips them; everything else is a plain TS module.
const skipEntries = new Set(["web", "cli", "tui"]);
const deriveEntries = (parsed: unknown): ReadonlyArray<Entry> => {
  if (typeof parsed !== "object" || parsed === null || !("exports" in parsed)) return [];
  const exports = parsed.exports;
  if (typeof exports !== "object" || exports === null) return [];
  const out: Array<Entry> = [];
  for (const [key, val] of Object.entries(exports)) {
    if (key === "./package.json" || typeof val !== "object" || val === null) continue;
    const types = "types" in val && typeof val.types === "string" ? val.types : undefined;
    if (types === undefined) continue;
    const name = key === "." ? "index" : key.replace(/^\.\//, "");
    if (skipEntries.has(name)) continue;
    const file = nodePath.join(
      repoRoot,
      types.replace(/^\.\/dist\//, "src/").replace(/\.d\.ts$/, ".ts"),
    );
    if (nodeFs.existsSync(file)) out.push({ name, file });
  }
  return out;
};

const readEntries = Effect.gen(function* () {
  const text = yield* readText(packageJsonPath);
  const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
    Effect.mapError((cause) => new FileError({ path: packageJsonPath, cause })),
  );
  return deriveEntries(parsed);
});

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  baseUrl: repoRoot,
  paths: {
    "@nikscripts/effect-pm": ["src/index.ts"],
    "@nikscripts/effect-pm/*": ["src/*"],
  },
};

// Alias-preserving format: keep named types (`Layer.Layer<…>`) instead of expanding their structure.
const formatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteTypeArgumentsOfSignature |
  ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType |
  ts.TypeFormatFlags.WriteArrayAsGenericType;

// typeToString emits `import("/abs/path").Name` — strip the import() wrapper (as expandType.ts does).
const strip = (text: string): string =>
  text.replace(/import\("[^"]*"\)\./g, "").replace(/\s*\n\s*/g, " ");

// --- pure extraction: everything below is a function of the checker, no IO ---
const srcDir = `${nodePath.join(repoRoot, "src")}/`;
const makeExtractor = (checker: ts.TypeChecker) => {
  // Re-exports (`export { x } from "./y"`) arrive as Alias symbols carrying no docs of their own —
  // resolve to the real symbol before reading anything.
  const resolve = (sym: ts.Symbol): ts.Symbol =>
    (sym.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(sym) : sym;

  const isPublic = (sym: ts.Symbol): boolean =>
    sym.getJsDocTags(checker).some((tag) => tag.name === "public");

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

  const rawCommentOf = (decl: ts.Declaration): string => {
    const jsdoc = ts.getJSDocCommentsAndTags(decl).filter(ts.isJSDoc);
    return jsdoc.length > 0 ? jsdoc[jsdoc.length - 1].getText() : "";
  };

  const toApi = (entry: Entry, exportSym: ts.Symbol): ReadonlyArray<ApiSymbol> => {
    const sym = resolve(exportSym);
    const decl = sym.getDeclarations()?.[0];
    if (decl === undefined) return [];
    // Only document what THIS package defines. A re-export whose definition resolves into a dependency
    // (e.g. `export type { ConsumeResult } from "effect/…"`) belongs in that package's docs, not ours.
    if (!decl.getSourceFile().fileName.startsWith(srcDir)) return [];
    if (!isPublic(sym)) return [];

    // Value symbols → getTypeOfSymbolAtLocation; type/interface/class → getDeclaredTypeOfSymbol.
    const isType =
      (sym.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) !== 0;
    const type = isType
      ? checker.getDeclaredTypeOfSymbol(sym)
      : checker.getTypeOfSymbolAtLocation(sym, decl);

    const signatures = type
      .getCallSignatures()
      .map((sig) => strip(checker.signatureToString(sig, decl, formatFlags, ts.SignatureKind.Call)));
    const fullType = strip(checker.typeToString(type, decl, formatFlags));
    const typeText =
      signatures.length > 0
        ? undefined
        : fullType.length > 400
          ? `${fullType.slice(0, 399)}…`
          : fullType;

    const tags = sym
      .getJsDocTags(checker)
      .map((tag): Schema.Schema.Type<typeof ApiTag> => ({
        name: tag.name,
        text: ts.displayPartsToString(tag.text ?? []),
      }));
    const rawComment = rawCommentOf(decl);
    const source = decl.getSourceFile();

    return [
      {
        entry: entry.name,
        name: exportSym.getName(),
        url: `/api/${entry.name}/${exportSym.getName()}`,
        kind: kindOf(sym),
        signatures,
        typeText,
        summary: strip(ts.displayPartsToString(sym.getDocumentationComment(checker))),
        rawComment,
        tags,
        category: tags.find((tag) => tag.name === "category")?.text,
        linkTargets: [...new Set([...rawComment.matchAll(/\{@link\s+([^}|\s]+)/g)].map((m) => m[1]))],
        source: {
          file: nodePath.relative(repoRoot, source.fileName),
          line: source.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
        },
      },
    ];
  };

  return toApi;
};

const program = Effect.gen(function* () {
  const outPath = yield* Config.string("API_OUT").pipe(Config.withDefault(defaultOutPath));
  const wanted = process.argv.slice(2);
  const all = yield* readEntries;
  const entries = wanted.length > 0 ? all.filter((e) => wanted.includes(e.name)) : all;

  const tsProgram = yield* Effect.sync(() =>
    ts.createProgram(
      entries.map((e) => e.file),
      compilerOptions,
    ),
  );
  const checker = tsProgram.getTypeChecker();
  const toApi = makeExtractor(checker);

  const model: ReadonlyArray<ApiEntry> = yield* Effect.forEach(entries, (entry) =>
    Effect.gen(function* () {
      const sf = tsProgram.getSourceFile(entry.file);
      const moduleSym = sf !== undefined ? checker.getSymbolAtLocation(sf) : undefined;
      if (moduleSym === undefined) {
        yield* Console.warn(`! no module symbol for ${entry.name}`);
        return { entry: entry.name, symbols: [] };
      }
      const symbols = checker
        .getExportsOfModule(moduleSym)
        .flatMap((s) => toApi(entry, s))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { entry: entry.name, symbols };
    }),
  );

  const generated = DateTime.formatIso(yield* DateTime.now);
  const json = yield* Schema.encodeEffect(Schema.fromJsonString(ApiModel))({
    generated,
    entries: model,
  }).pipe(Effect.mapError((cause) => new FileError({ path: outPath, cause })));
  yield* writeText(outPath, `${json}\n`);

  const total = model.reduce((n, e) => n + e.symbols.length, 0);
  yield* Console.log(`wrote ${outPath}`);
  yield* Console.log(`${model.length} entries, ${total} @public symbols`);
  yield* Effect.forEach(model, (e) => Console.log(`  ${e.entry.padEnd(20)} ${e.symbols.length}`));
});

// Surface any failure — typed error or defect — as a value, then let the exit code decide.
const main = program.pipe(Effect.tapCause((cause) => Console.error(Cause.pretty(cause))));
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
