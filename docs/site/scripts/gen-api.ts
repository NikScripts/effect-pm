// PROTOTYPE API-reference extractor.
//
// Builds one TS program over the package's entry points (derived from package.json `exports`), walks
// each entry's `@public` exports, and resolves every signature THROUGH THE CHECKER — so inferred
// return types (never written in source) are captured. Emits an `api.json` model the docs site renders
// with its existing Shiki + jsdocToHast. Same checker machinery as docs/site/src/lib/expandType.ts,
// generalised from per-hover to the whole surface.
//
// Per Effect Style all IO goes through platform services — file reads/writes via effect/FileSystem,
// git via effect/unstable/process (never node:fs / node:child_process). node:path stays for the pure
// path math the checker walk needs (no IO). The model is a Schema (so the JSON round-trips through a
// codec, not hand-rolled), and every failure is a value in the error channel.
//
//   tsx scripts/gen-api.ts [entryName ...]     (no args = all core entries)

import * as nodePath from "node:path"; // pure path math only — no IO (keeps the extractor pure)
import { fileURLToPath } from "node:url";
import { Cause, Config, Console, Data, Effect, Exit, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { NodeServices } from "@effect/platform-node";
import prettier from "prettier";
import ts from "typescript";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const packageJsonPath = nodePath.join(repoRoot, "package.json");
// Split, per-page data lives under docs/site/api-data/ (one file per symbol + per-module summaries +
// a tiny index), so each page loads only its own slice — never one giant model.
const dataDir = nodePath.join(repoRoot, "docs/site/api-data");

// The documented package. `slug` is the URL segment (/api/<slug>/…); `name` is the npm name.
const pkgSlug = "effect-pm";
// A namespace entry -> its URL slug. Mirrors src/lib/api-data.ts (kept in sync).
const slugForEntry = (entry: string): string =>
  entry === "(top-level)" ? "top-level" : entry.replace(/\//g, "-");

// An export name -> its on-disk data-file key. Names can differ only by case (a type `Foo` and a value
// `foo` in one module); on a case-insensitive filesystem `Foo.json` and `foo.json` are the SAME file,
// so one clobbers the other. Lowercase the name + append the uppercase-letter positions (joined by
// `-`, which no identifier contains); pure-lowercase names are unchanged. The URL keeps the real name;
// only the file uses this key. Mirrors src/lib/api-data.ts (kept in sync).
const symbolFileKey = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower === name) return name;
  const upper = [...name].flatMap((c, i) => (c !== c.toLowerCase() ? [i] : []));
  return `${lower}-${upper.join("-")}`;
};

// git, through effect/unstable/process (never node:child_process). Returns trimmed stdout, or "" if
// the command fails — every git call here is best-effort metadata (origin URL, branch, submodule SHA).
const git = (
  ...args: ReadonlyArray<string>
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.string(ChildProcess.make("git", [...args], { cwd: repoRoot })),
  ).pipe(
    Effect.map((out) => out.trim()),
    Effect.catch(() => Effect.succeed("")),
  );

// The GitHub blob base for "view source" links — `https://github.com/OWNER/REPO/blob/REF`. OWNER/REPO
// come from the origin remote; REF is SOURCE_REF (for CI) or the current branch, else `main`. Empty
// string if the remote isn't GitHub, and the site then renders the path as plain text.
const resolveRepoBaseUrl: Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =
  Effect.gen(function* () {
    const remote = yield* git("remote", "get-url", "origin");
    const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (m === null) return "";
    // SOURCE_REF (CI) overrides the branch; env flows through Config, never a raw process.env read.
    const sourceRef = yield* Config.string("SOURCE_REF").pipe(Config.withDefault(""));
    const ref = sourceRef || (yield* git("rev-parse", "--abbrev-ref", "HEAD")) || "main";
    return `https://github.com/${m[1]}/${m[2]}/blob/${ref}`;
  }).pipe(Effect.catch(() => Effect.succeed(""))); // best-effort: any Config/git failure -> no links

// The npm name from a parsed package.json (falls back to the slug). Pure — the read happens in-program.
const pkgNameOf = (parsed: unknown): string =>
  typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string"
    ? parsed.name
    : pkgSlug;

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
  sourceText: Schema.String, // the export's actual source (the declaration as written), shown verbatim
  summary: Schema.String, // resolved doc summary (previews / search)
  rawComment: Schema.String, // raw /** … */ with {@link} intact (the site re-renders this)
  tags: Schema.Array(ApiTag),
  category: Schema.optional(Schema.String),
  linkTargets: Schema.Array(Schema.String), // {@link X} names referenced
  // {@link X} text -> resolved doc URL. The compiler decides the exact target, so bare names
  // disambiguate correctly (e.g. `layer` -> QueueResource.layer within QueueResource's doc).
  docLinks: Schema.Record(Schema.String, Schema.String),
  source: Schema.Struct({
    file: Schema.String, // repo-relative (for reading the source panel)
    line: Schema.Number,
    url: Schema.optional(Schema.String), // GitHub blob URL (package-specific repo)
  }),
});
interface ApiEntry {
  readonly entry: string;
  readonly symbols: ReadonlyArray<ApiSymbol>;
}
type ApiSymbol = Schema.Schema.Type<typeof ApiSymbol>;

interface Entry {
  readonly name: string; // "Resource", "storage/sqlite", "index"
  readonly file: string; // absolute path to src/*.ts
}

// --- file IO through effect/FileSystem (never node:fs) — each op maps its PlatformError to the
// domain FileError, so every failure stays a value carrying the offending path ---
const readText = (path: string): Effect.Effect<string, FileError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.mapError((cause) => new FileError({ path, cause })),
  );

// Write a JSON file, creating parent dirs as needed. Plain JSON.stringify — the model is all
// strings/numbers/arrays (no rich Effect types), so no Schema codec is needed for the round-trip.
const writeJson = (
  path: string,
  value: unknown,
): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .makeDirectory(nodePath.dirname(path), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path, `${JSON.stringify(value)}\n`))),
  ).pipe(Effect.mapError((cause) => new FileError({ path, cause })));

// Entry points ARE the public surface — derive them from `exports` (SSOT), mapping the published
// `./dist/X.d.ts` back to its `src/X.ts`. UI entries (web/cli/tui) pull JSX/browser libs, so the
// prototype skips them; everything else is a plain TS module.
const skipEntries = new Set(["web", "cli", "tui"]);
const deriveEntries = (
  parsed: unknown,
): Effect.Effect<ReadonlyArray<Entry>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (typeof parsed !== "object" || parsed === null || !("exports" in parsed)) return [];
    const exports = parsed.exports;
    if (typeof exports !== "object" || exports === null) return [];
    const fs = yield* FileSystem.FileSystem;
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
      const exists = yield* fs.exists(file).pipe(Effect.catch(() => Effect.succeed(false)));
      if (exists) out.push({ name, file });
    }
    return out;
  });

// Parse package.json once; the program derives both the entry points and the npm name from it.
const readPackageJson = Effect.gen(function* () {
  const text = yield* readText(packageJsonPath);
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
    Effect.mapError((cause) => new FileError({ path: packageJsonPath, cause })),
  );
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

// Display formatting via Prettier: signatures/types from the checker are one long line, so wrap each
// in a valid TS construct, format, and strip the wrapper — long overloads break across lines instead
// of scrolling. Best-effort: an unparseable fragment is shown as-is.
const prettierOpts = { parser: "typescript" as const, printWidth: 76, semi: false };
const formatSignature = (sig: string): string => {
  try {
    return prettier
      .format(`interface _ {\n${sig}\n}`, prettierOpts)
      .trim()
      .replace(/^interface _ \{\n?/, "")
      .replace(/\n?\}$/, "")
      .replace(/^ {2}/gm, "")
      .trim();
  } catch {
    return sig;
  }
};
const formatType = (t: string): string => {
  try {
    return prettier
      .format(`type _ = ${t}\n`, prettierOpts)
      .trim()
      .replace(/^type _ =\s*/, "")
      .replace(/;\s*$/, "")
      .trim();
  } catch {
    return t;
  }
};

// --- pure extraction: everything below is a function of the checker, no IO ---
// One documented package (ours, or a dependency like effect).
interface PkgConfig {
  readonly slug: string; // URL segment: /api/<slug>/…
  readonly name: string; // npm name shown on the package page
  readonly entries: ReadonlyArray<Entry>; // program roots; the "index" one is the barrel of modules
  readonly srcDir: string; // absolute, trailing slash — only document declarations under here
  readonly repoBaseUrl: string; // GitHub blob base for this package's source ("" = no source links)
  readonly repoPathPrefix: string; // stripped from the repo-relative file for the GitHub URL
  readonly options: ts.CompilerOptions;
  readonly isPublic: (sym: ts.Symbol, checker: ts.TypeChecker) => boolean;
}

const makeExtractor = (checker: ts.TypeChecker, cfg: PkgConfig) => {
  // Re-exports (`export { x } from "./y"`) arrive as Alias symbols carrying no docs of their own —
  // resolve to the real symbol before reading anything.
  const resolve = (sym: ts.Symbol): ts.Symbol =>
    (sym.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(sym) : sym;

  // Filled during extraction; used AFTER (resolveDocLinks) once every symbol has a URL.
  const symbolUrl = new Map<ts.Symbol, string>(); // resolved export symbol -> its doc URL
  const declOf = new Map<ApiSymbol, ts.Declaration>(); // api object -> its primary declaration

  const isPublic = (sym: ts.Symbol): boolean => cfg.isPublic(sym, checker);

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
    if (!decl.getSourceFile().fileName.startsWith(cfg.srcDir)) return [];
    if (!isPublic(sym)) return [];

    // Value symbols → getTypeOfSymbolAtLocation; type/interface/class → getDeclaredTypeOfSymbol.
    const isType =
      (sym.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) !== 0;
    const type = isType
      ? checker.getDeclaredTypeOfSymbol(sym)
      : checker.getTypeOfSymbolAtLocation(sym, decl);

    const signatures = type
      .getCallSignatures()
      .map((sig) =>
        formatSignature(strip(checker.signatureToString(sig, decl, formatFlags, ts.SignatureKind.Call))),
      );
    const fullType = strip(checker.typeToString(type, decl, formatFlags));
    const typeText = signatures.length > 0 ? undefined : formatType(fullType);

    const tags = sym
      .getJsDocTags(checker)
      .map((tag): Schema.Schema.Type<typeof ApiTag> => ({
        name: tag.name,
        text: ts.displayPartsToString(tag.text ?? []),
      }));
    const source = decl.getSourceFile();
    // REAL source, cut straight out of the file. The LSP gives each declaration's exact range; take
    // the contiguous span covering this symbol's declarations (overloads carry several) and slice it
    // from the source text verbatim — no AST re-print. A `const`/`let` declaration's `const`/`export`
    // keyword lives on the enclosing statement, so climb to it.
    const declNode = (d: ts.Declaration): ts.Node =>
      ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) ? d.parent.parent : d;
    const nodes = (sym.getDeclarations() ?? [])
      .filter((d) => d.getSourceFile().fileName === source.fileName)
      .map(declNode);
    const spanStart = Math.min(...nodes.map((n) => n.getStart()));
    const spanEnd = Math.max(...nodes.map((n) => n.getEnd()));
    const sourceText = nodes.length > 0 ? source.text.slice(spanStart, spanEnd) : "";
    const sourceLine = source.getLineAndCharacterOfPosition(spanStart).line + 1;
    const rawComment = rawCommentOf(decl);
    const name = exportSym.getName();
    const qualifiedName = ns === undefined ? name : `${ns}.${name}`;
    const url = `/api/${cfg.slug}/${slugForEntry(ns ?? "(top-level)")}/${name}`;
    const relFile = nodePath.relative(repoRoot, source.fileName);

    const api: ApiSymbol = {
      entry: ns ?? "(top-level)",
      name,
      qualifiedName,
      url,
      kind: kindOf(sym),
      signatures,
      typeText,
      sourceText,
      summary: strip(ts.displayPartsToString(sym.getDocumentationComment(checker))),
      rawComment,
      tags,
      category: tags.find((tag) => tag.name === "category")?.text,
      linkTargets: [...new Set([...rawComment.matchAll(/\{@link\s+([^}|\s]+)/g)].map((m) => m[1]))],
      docLinks: {}, // filled by resolveDocLinks after every symbol has a URL
      source: {
        file: relFile,
        line: sourceLine,
        url:
          cfg.repoBaseUrl !== ""
            ? `${cfg.repoBaseUrl}/${relFile.startsWith(cfg.repoPathPrefix) ? relFile.slice(cfg.repoPathPrefix.length) : relFile}#L${sourceLine}`
            : undefined,
      },
    };
    symbolUrl.set(sym, url);
    declOf.set(api, decl);
    return [api];
  };

  // Resolve a symbol's {@link X} targets to doc URLs via the checker — the compiler picks the exact
  // symbol, so bare names disambiguate by context. Run AFTER extraction (symbolUrl complete).
  const resolveDocLinks = (api: ApiSymbol): Record<string, string> => {
    const decl = declOf.get(api);
    if (decl === undefined) return {};
    const out: Record<string, string> = {};
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJSDocLink(node) || ts.isJSDocLinkCode(node) || ts.isJSDocLinkPlain(node)) &&
        node.name !== undefined
      ) {
        const target = checker.getSymbolAtLocation(node.name);
        const resolved = target === undefined ? undefined : symbolUrl.get(resolve(target));
        if (resolved !== undefined) out[node.name.getText()] = resolved;
      }
      node.forEachChild(visit);
    };
    for (const j of ts.getJSDocCommentsAndTags(decl)) visit(j);
    return out;
  };

  return { toApi, resolve, resolveDocLinks };
};

// `export * as X` / a subpath module resolves to a symbol whose declaration IS a source file.
const isModuleSym = (sym: ts.Symbol): boolean =>
  (sym.getDeclarations() ?? []).some((d) => ts.isSourceFile(d));

// Extract one package's model: build a program over its entries, walk the barrel's `export * as`
// modules (+ any non-barrel subpath entries), resolve every symbol, then resolve {@link}s.
const extractPackage = (cfg: PkgConfig) => Effect.gen(function* () {
  const tsProgram = yield* Effect.sync(() =>
    ts.createProgram(
      cfg.entries.map((e) => e.file),
      cfg.options,
    ),
  );
  const checker = tsProgram.getTypeChecker();
  const { toApi, resolve, resolveDocLinks } = makeExtractor(checker, cfg);
  const moduleOf = (file: string): ts.Symbol | undefined => {
    const sf = tsProgram.getSourceFile(file);
    return sf === undefined ? undefined : checker.getSymbolAtLocation(sf);
  };

  // Namespace groups = every subpath entry (its own `import * as` namespace) PLUS any barrel
  // `export * as NS` whose module has no subpath of its own (e.g. RunResource, LogEntry).
  const barrel = cfg.entries.find((e) => e.name === "index");
  const barrelMod = barrel === undefined ? undefined : moduleOf(barrel.file);
  const subpathFiles = new Set(cfg.entries.map((e) => e.file));
  const groups: Array<{ ns: string; module: ts.Symbol }> = [];
  for (const e of cfg.entries) {
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

  // A symbol can be exported under several names — its internal name AND a `export { x as Public }`
  // rename (e.g. `customQueueTag` and `… as Tag`). Show only the PUBLIC rename a caller is meant to
  // use, never a second entry under the internal name.
  const preferRename = (mods: ReadonlyArray<ts.Symbol>): ReadonlyArray<ts.Symbol> => {
    const byResolved = new Map<ts.Symbol, Array<ts.Symbol>>();
    for (const m of mods) {
      const r = resolve(m);
      const arr = byResolved.get(r);
      if (arr === undefined) byResolved.set(r, [m]);
      else arr.push(m);
    }
    return [...byResolved].map(([r, exps]) => exps.find((e) => e.getName() !== r.getName()) ?? exps[0]);
  };

  const nsEntries: Array<ApiEntry> = groups.map((g) => ({
    entry: g.ns,
    symbols: preferRename(checker.getExportsOfModule(g.module))
      .flatMap((m) => toApi(g.ns, m))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const topLevel =
    barrelMod === undefined
      ? []
      : preferRename(checker.getExportsOfModule(barrelMod))
          .filter((ex) => !isModuleSym(resolve(ex)) && !namespaced.has(resolve(ex)))
          .flatMap((ex) => toApi(undefined, ex))
          .sort((a, b) => a.name.localeCompare(b.name));

  const extracted: ReadonlyArray<ApiEntry> = [
    ...nsEntries,
    { entry: "(top-level)", symbols: topLevel },
  ]
    .filter((e) => e.symbols.length > 0)
    // Modules list alphabetically; bare top-level exports lead.
    .sort((a, b) =>
      a.entry === "(top-level)"
        ? -1
        : b.entry === "(top-level)"
          ? 1
          : a.entry.localeCompare(b.entry),
    );

  // Second pass: resolve every symbol's {@link} targets now that all URLs are known.
  const model: ReadonlyArray<ApiEntry> = extracted.map((e) => ({
    entry: e.entry,
    symbols: e.symbols.map((s) => ({ ...s, docLinks: resolveDocLinks(s) })),
  }));

  return model;
});

const effectOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  allowImportingTsExtensions: true, // effect-smol imports use explicit `.ts` extensions
  noEmit: true,
};

const effectPackagesDir = nodePath.join(repoRoot, "repos/effect/packages");

// A PkgConfig for one effect-smol package dir (must contain src/index.ts). Documented like core
// effect: @category/@since = public, GitHub source at the pinned submodule SHA. Its slug is the npm
// name minus the `@effect/` scope (`@effect/platform-node` -> `platform-node`; core `effect` stays
// `effect`), so every package gets its own /api/<slug>/… tree and modules page.
const specForEffectPkg = (
  pkgDir: string,
  repoBaseUrl: string,
): Effect.Effect<PkgConfig, FileError, FileSystem.FileSystem> =>
  readText(nodePath.join(pkgDir, "package.json")).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
        Effect.mapError((cause) => new FileError({ path: pkgDir, cause })),
      ),
    ),
    Effect.map((parsed) => {
      const name =
        typeof parsed === "object" &&
        parsed !== null &&
        "name" in parsed &&
        typeof parsed.name === "string"
          ? parsed.name
          : nodePath.basename(pkgDir);
      return {
        slug: name.replace(/^@effect\//, ""),
        name,
        entries: [{ name: "index", file: nodePath.join(pkgDir, "src", "index.ts") }],
        srcDir: `${nodePath.join(pkgDir, "src")}/`,
        repoBaseUrl,
        repoPathPrefix: "repos/effect/",
        options: effectOptions,
        isPublic: (sym: ts.Symbol, checker: ts.TypeChecker) =>
          sym.getJsDocTags(checker).some((t) => t.name === "category" || t.name === "since"),
      };
    }),
  );

// Every effect-smol package (a dir with src/index.ts) except `tools/*` (build tooling, not library
// APIs). The meta-dirs ai/sql/atom hold no src of their own, so they expand to their child packages.
const enumerateEffectPkgDirs: Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const hasIndex = (d: string) =>
      fs.exists(nodePath.join(d, "src", "index.ts")).pipe(Effect.catch(() => Effect.succeed(false)));
    const readDir = (d: string) =>
      fs.readDirectory(d).pipe(Effect.catch(() => Effect.succeed([])));
    const dirs: Array<string> = [];
    for (const entry of yield* readDir(effectPackagesDir)) {
      if (entry === "tools") continue;
      const dir = nodePath.join(effectPackagesDir, entry);
      if (yield* hasIndex(dir)) {
        dirs.push(dir);
        continue;
      }
      for (const sub of yield* readDir(dir)) {
        const subDir = nodePath.join(dir, sub);
        if (yield* hasIndex(subDir)) dirs.push(subDir);
      }
    }
    return dirs.sort();
  });

const program = Effect.gen(function* () {
  const wanted = process.argv.slice(2); // optional: restrict to these package slugs
  const parsed = yield* readPackageJson;
  const ourEntries = yield* deriveEntries(parsed);
  const pkgName = pkgNameOf(parsed);
  const repoBaseUrl = yield* resolveRepoBaseUrl;
  const effectRef = (yield* git("-C", "repos/effect", "rev-parse", "HEAD")) || "main";
  const effectRepoBaseUrl = `https://github.com/Effect-TS/effect-smol/blob/${effectRef}`;
  const effectPkgDirs = yield* enumerateEffectPkgDirs;
  const effectSpecs = yield* Effect.forEach(effectPkgDirs, (d) =>
    specForEffectPkg(d, effectRepoBaseUrl),
  );

  const allSpecs: ReadonlyArray<PkgConfig> = [
    {
      slug: pkgSlug,
      name: pkgName,
      entries: ourEntries,
      srcDir: `${nodePath.join(repoRoot, "src")}/`,
      repoBaseUrl,
      repoPathPrefix: "",
      options: compilerOptions,
      isPublic: (sym, checker) => sym.getJsDocTags(checker).some((t) => t.name === "public"),
    },
    // Every effect-smol package (core effect + platform + observability + ai/sql/atom providers).
    ...effectSpecs,
  ];
  const specs = wanted.length === 0 ? allSpecs : allSpecs.filter((s) => wanted.includes(s.slug));

  yield* Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.remove(dataDir, { recursive: true, force: true }),
  ).pipe(Effect.mapError((cause) => new FileError({ path: dataDir, cause })));

  const pkgInfos: Array<{
    slug: string;
    name: string;
    modules: Array<{ slug: string; entry: string; count: number }>;
  }> = [];
  const paths: Array<readonly [string, string, string]> = [];
  const links: Array<{ name: string; qualifiedName: string; url: string }> = [];
  const doclinks: Record<string, Record<string, string>> = {};

  for (const spec of specs) {
    const model = yield* extractPackage(spec);
    const modules: Array<{ slug: string; entry: string; count: number }> = [];
    yield* Effect.forEach(model, (e) =>
      Effect.gen(function* () {
        const nsSlug = slugForEntry(e.entry);
        // module summary: light rows (no signatures / source / comments) for the module page
        const rows = e.symbols.map((s) => ({
          name: s.name,
          qualifiedName: s.qualifiedName,
          kind: s.kind,
          summary: s.summary,
          url: s.url,
        }));
        yield* writeJson(nodePath.join(dataDir, spec.slug, `${nsSlug}.json`), {
          package: spec.slug,
          entry: e.entry,
          symbols: rows,
        });
        yield* Effect.forEach(e.symbols, (s) =>
          writeJson(nodePath.join(dataDir, spec.slug, nsSlug, `${symbolFileKey(s.name)}.json`), s),
        );
        modules.push({ slug: nsSlug, entry: e.entry, count: e.symbols.length });
        for (const s of e.symbols) {
          paths.push([spec.slug, nsSlug, s.name]);
          links.push({ name: s.name, qualifiedName: s.qualifiedName, url: s.url });
          if (Object.keys(s.docLinks).length > 0) {
            doclinks[`${s.source.file}:${s.source.line}`] = s.docLinks;
          }
        }
      }),
    );
    pkgInfos.push({ slug: spec.slug, name: spec.name, modules });
    const total = model.reduce((n, e) => n + e.symbols.length, 0);
    yield* Console.log(`  ${spec.slug.padEnd(12)} ${model.length} modules, ${total} symbols`);
  }

  yield* writeJson(nodePath.join(dataDir, "index.json"), { packages: pkgInfos });
  yield* writeJson(nodePath.join(dataDir, "paths.json"), { symbols: paths });
  yield* writeJson(nodePath.join(dataDir, "links.json"), { symbols: links });
  yield* writeJson(nodePath.join(dataDir, "meta.json"), { repoBaseUrl });
  yield* writeJson(nodePath.join(dataDir, "doclinks.json"), doclinks);
  yield* Console.log(`wrote ${dataDir} — ${pkgInfos.length} package(s)`);
});

// Surface any failure — typed error or defect — as a value, then let the exit code decide. The Node
// platform services (FileSystem, Path, ChildProcessSpawner) are provided once, here at the edge.
const main = program.pipe(
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  Effect.provide(NodeServices.layer),
);
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
