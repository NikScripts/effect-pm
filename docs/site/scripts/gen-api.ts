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
  entry: Schema.String, // the namespace this symbol is grouped under ("(top-level)" for bare exports)
  name: Schema.String, // the bare export name
  qualifiedName: Schema.String, // how you reach it: `Namespace.name`, or just `name` at top level
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

  // `ns` is the namespace the symbol is reached through (subpath `import * as ns`, or a barrel
  // `export * as ns`); undefined means a bare top-level export, shown unprefixed.
  const toApi = (ns: string | undefined, exportSym: ts.Symbol): ReadonlyArray<ApiSymbol> => {
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
    const name = exportSym.getName();
    const qualifiedName = ns === undefined ? name : `${ns}.${name}`;

    return [
      {
        entry: ns ?? "(top-level)",
        name,
        qualifiedName,
        url: `/api/${ns ?? "top-level"}/${name}`,
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

  return { toApi, resolve };
};

// `export * as X` / a subpath module resolves to a symbol whose declaration IS a source file.
const isModuleSym = (sym: ts.Symbol): boolean =>
  (sym.getDeclarations() ?? []).some((d) => ts.isSourceFile(d));

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
  const { toApi, resolve } = makeExtractor(checker);
  const moduleOf = (file: string): ts.Symbol | undefined => {
    const sf = tsProgram.getSourceFile(file);
    return sf === undefined ? undefined : checker.getSymbolAtLocation(sf);
  };

  // Namespace groups = every subpath entry (its own `import * as` namespace) PLUS any barrel
  // `export * as NS` whose module has no subpath of its own (e.g. RunResource, LogEntry).
  const barrel = entries.find((e) => e.name === "index");
  const barrelMod = barrel === undefined ? undefined : moduleOf(barrel.file);
  const subpathFiles = new Set(entries.map((e) => e.file));
  const groups: Array<{ ns: string; module: ts.Symbol }> = [];
  for (const e of entries) {
    if (e.name === "index") continue;
    const mod = moduleOf(e.file);
    if (mod !== undefined) groups.push({ ns: e.name, module: mod });
  }
  if (barrelMod !== undefined) {
    for (const ex of checker.getExportsOfModule(barrelMod)) {
      const r = resolve(ex);
      const d = r.getDeclarations()?.[0];
      if (d !== undefined && ts.isSourceFile(d) && !subpathFiles.has(d.fileName)) {
        groups.push({ ns: ex.getName(), module: r });
      }
    }
  }

  // Every symbol reachable through a namespace — so the barrel's bare re-exports of them are dropped
  // (shown once, under their namespace) and only genuinely top-level bare exports remain.
  const namespaced = new Set<ts.Symbol>();
  for (const g of groups) {
    for (const m of checker.getExportsOfModule(g.module)) namespaced.add(resolve(m));
  }

  const nsEntries: Array<ApiEntry> = groups.map((g) => ({
    entry: g.ns,
    symbols: checker
      .getExportsOfModule(g.module)
      .flatMap((m) => toApi(g.ns, m))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const topLevel =
    barrelMod === undefined
      ? []
      : checker
          .getExportsOfModule(barrelMod)
          .filter((ex) => !isModuleSym(resolve(ex)) && !namespaced.has(resolve(ex)))
          .flatMap((ex) => toApi(undefined, ex))
          .sort((a, b) => a.name.localeCompare(b.name));

  const model: ReadonlyArray<ApiEntry> = [
    ...nsEntries,
    { entry: "(top-level)", symbols: topLevel },
  ]
    .filter((e) => e.symbols.length > 0)
    .sort((a, b) => b.symbols.length - a.symbols.length);

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
