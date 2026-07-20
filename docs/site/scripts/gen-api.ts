// Generate the split API model for the docs site — extraction through the docgen services
// (TsProgram + Extractor.package: compiler-resolved signatures, module walk, {@link} second pass).
// This IS the Phase 5 cutover of the D4 bridge (gen-api-next.ts): same writer, byte-identical
// output, prototype extractor deleted. Writes docs/site/api-data/ (one file per symbol +
// per-module summaries + index/paths/doclinks/locations sidecars).
//
//   tsx scripts/gen-api.ts [pkgSlug ...]     (no args = effect-pm + every documented effect dep)

import * as nodePath from "node:path"; // pure path math only — no IO (keeps the extractor pure)
import { fileURLToPath } from "node:url";
import { Cause, Config, Console, Data, Effect, Exit, Layer, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { NodeServices } from "@effect/platform-node";
import ts from "typescript";
import { Option } from "effect";
import * as Extractor from "../src/docgen/Extractor.js";
import * as LinkResolver from "../src/docgen/LinkResolver.js";
import * as SourceRenderer from "../src/docgen/SourceRenderer.js";
import * as SymbolIndex from "../src/docgen/SymbolIndex.js";
import * as TsProgram from "../src/docgen/TsProgram.js";
import { slugForEntry, symbolFileKey } from "../src/lib/api-slugs.js";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const packageJsonPath = nodePath.join(repoRoot, "package.json");
// Split, per-page data lives under docs/site/api-data/ (one file per symbol + per-module
// summaries + a tiny index) — the site readers (src/lib/api-data.ts) resolve it from cwd.
const dataDir = nodePath.join(repoRoot, "docs/site/api-data");

// The documented package. `slug` is the URL segment (/api/<slug>/…); `name` is the npm name.
const pkgSlug = "effect-pm";

// git, through effect/unstable/process (never node:child_process). Returns trimmed stdout, or "" if
// the command fails — every git call here is best-effort metadata (origin URL, branch, submodule SHA).
const git = (
  ...args: ReadonlyArray<string>
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.string(ChildProcess.make("git", [...args], { cwd: repoRoot }))
  ).pipe(
    Effect.map((out) => out.trim()),
    Effect.catch(() => Effect.succeed(""))
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
  typeof parsed === "object" &&
  parsed !== null &&
  "name" in parsed &&
  typeof parsed.name === "string"
    ? parsed.name
    : pkgSlug;

// The `effect` / `@effect/*` packages effect-pm actually depends on (runtime + peer). We document only
// these — the wider monorepo (ai/atom/other-sql/browser/bun) is surface a consumer of effect-pm never
// touches. Derived from OUR package.json so it tracks the deps automatically.
const effectDepsOf = (parsed: unknown): ReadonlySet<string> => {
  const names = new Set<string>();
  if (typeof parsed !== "object" || parsed === null) return names;
  for (const [section, deps] of Object.entries(parsed)) {
    if (section !== "dependencies" && section !== "peerDependencies") continue;
    if (typeof deps !== "object" || deps === null) continue;
    for (const name of Object.keys(deps)) {
      if (name === "effect" || name.startsWith("@effect/")) names.add(name);
    }
  }
  return names;
};

// One named error per failure mode (Principles → Errors are values).
class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

// --- file IO through effect/FileSystem (never node:fs) — each op maps its PlatformError to the
// domain FileError, so every failure stays a value carrying the offending path ---
const readText = (path: string): Effect.Effect<string, FileError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.mapError((cause) => new FileError({ path, cause }))
  );

// Write a JSON file, creating parent dirs as needed. Plain JSON.stringify — the model is all
// strings/numbers/arrays (no rich Effect types), so no Schema codec is needed for the round-trip.
const writeJson = (
  path: string,
  value: unknown
): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .makeDirectory(nodePath.dirname(path), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path, `${JSON.stringify(value)}\n`)))
  ).pipe(Effect.mapError((cause) => new FileError({ path, cause })));

// Entry points ARE the public surface — derive them from `exports` (SSOT), mapping the published
// `./dist/X.d.ts` back to its `src/X.ts`. UI entries (web/cli/tui) pull JSX/browser libs, so the
// prototype skips them; everything else is a plain TS module.
const skipEntries = new Set(["web", "cli", "tui"]);
const deriveEntries = (
  parsed: unknown
): Effect.Effect<ReadonlyArray<Extractor.EntryPoint>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (typeof parsed !== "object" || parsed === null || !("exports" in parsed)) return [];
    const exports = parsed.exports;
    if (typeof exports !== "object" || exports === null) return [];
    const fs = yield* FileSystem.FileSystem;
    const out: Array<Extractor.EntryPoint> = [];
    for (const [key, val] of Object.entries(exports)) {
      if (key === "./package.json" || typeof val !== "object" || val === null) continue;
      const types = "types" in val && typeof val.types === "string" ? val.types : undefined;
      if (types === undefined) continue;
      const name = key === "." ? "index" : key.replace(/^\.\//, "");
      if (skipEntries.has(name)) continue;
      const file = nodePath.join(
        repoRoot,
        types.replace(/^\.\/dist\//, "src/").replace(/\.d\.ts$/, ".ts")
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
    Effect.mapError((cause) => new FileError({ path: packageJsonPath, cause }))
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

// --- extraction, through the docgen services (the composable extractor gen-api prototyped) ---
// One documented package (ours, or a dependency like effect).
interface PkgConfig {
  readonly slug: string; // URL segment: /api/<slug>/…
  readonly name: string; // npm name shown on the package page
  readonly entries: ReadonlyArray<Extractor.EntryPoint>; // program roots; "index" is the barrel
  readonly srcDir: string; // absolute, trailing slash — only document declarations under here
  readonly repoBaseUrl: string; // GitHub blob base for this package's source ("" = no source links)
  readonly repoPathPrefix: string; // stripped from the repo-relative file for the GitHub URL
  readonly options: ts.CompilerOptions;
  readonly isPublic: (sym: ts.Symbol, checker: ts.TypeChecker) => boolean;
}

// Build a program over the package's entries, walk + extract + resolve {@link}s — all inside the
// Extractor service; each package gets its own TsProgram layer (its own compiler options).
const extractPackage = (cfg: PkgConfig) =>
  Effect.flatMap(Extractor.Extractor, (extractor) => extractor.package(cfg.entries)).pipe(
    Effect.provide(
      Extractor.layer({
        repoRoot,
        srcDir: cfg.srcDir,
        slug: cfg.slug,
        repoBaseUrl: cfg.repoBaseUrl,
        repoPathPrefix: cfg.repoPathPrefix,
        isPublic: cfg.isPublic,
      }).pipe(
        Layer.provide(
          TsProgram.layer({
            entries: cfg.entries.map((e) => e.file),
            compilerOptions: cfg.options,
          })
        )
      )
    )
  );

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
  repoBaseUrl: string
): Effect.Effect<PkgConfig, FileError, FileSystem.FileSystem> =>
  readText(nodePath.join(pkgDir, "package.json")).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
        Effect.mapError((cause) => new FileError({ path: pkgDir, cause }))
      )
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
    })
  );

// Every effect-smol package (a dir with src/index.ts) except `tools/*` (build tooling, not library
// APIs). The meta-dirs ai/sql/atom hold no src of their own, so they expand to their child packages.
const enumerateEffectPkgDirs: Effect.Effect<
  ReadonlyArray<string>,
  never,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const hasIndex = (d: string) =>
    fs.exists(nodePath.join(d, "src", "index.ts")).pipe(Effect.catch(() => Effect.succeed(false)));
  const readDir = (d: string) => fs.readDirectory(d).pipe(Effect.catch(() => Effect.succeed([])));
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
  const effectDeps = effectDepsOf(parsed);
  const effectSpecs = (yield* Effect.forEach(effectPkgDirs, (d) =>
    specForEffectPkg(d, effectRepoBaseUrl)
  )).filter((s) => effectDeps.has(s.name));

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
    fs.remove(dataDir, { recursive: true, force: true })
  ).pipe(Effect.mapError((cause) => new FileError({ path: dataDir, cause })));

  const pkgInfos: Array<{
    slug: string;
    name: string;
    modules: Array<{ slug: string; entry: string; count: number }>;
  }> = [];
  const paths: Array<readonly [string, string, string]> = [];
  const doclinks: Record<string, Record<string, string>> = {};
  // location → url, for the render-time SymbolIndex (compiler source links). Keyed by file#line
  // with the LAST write winning — the writer sees symbols in extraction order, so this reproduces
  // the Extractor's per-resolved-symbol dedup (multi-namespace re-exports keep one page per line).
  const locations = new Map<string, { file: string; line: number; url: string }>();
  // Every symbol's declaration span, per package — the cross-reference pass resolves each span's
  // identifiers to invert "who references whom".
  const spansBySpec: Array<
    Array<{ url: string; file: string; startLine: number; endLine: number }>
  > = specs.map(() => []);

  for (const [specIndex, spec] of specs.entries()) {
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
          writeJson(nodePath.join(dataDir, spec.slug, nsSlug, `${symbolFileKey(s.name)}.json`), s)
        );
        modules.push({ slug: nsSlug, entry: e.entry, count: e.symbols.length });
        for (const s of e.symbols) {
          paths.push([spec.slug, nsSlug, s.name]);
          if (Object.keys(s.docLinks).length > 0) {
            doclinks[`${s.source.file}:${s.source.line}`] = s.docLinks;
          }
          locations.set(`${s.source.file}#${s.source.line}`, {
            file: s.source.file,
            line: s.source.line,
            url: s.url,
          });
          spansBySpec[specIndex].push({
            url: s.url,
            file: s.source.file,
            startLine: s.source.line,
            endLine: s.source.line + s.sourceText.split("\n").length - 1,
          });
        }
      })
    );
    pkgInfos.push({ slug: spec.slug, name: spec.name, modules });
    const total = model.reduce((n, e) => n + e.symbols.length, 0);
    yield* Console.log(`  ${spec.slug.padEnd(12)} ${model.length} modules, ${total} symbols`);
  }

  yield* writeJson(nodePath.join(dataDir, "index.json"), { packages: pkgInfos });
  yield* writeJson(nodePath.join(dataDir, "paths.json"), { symbols: paths });
  yield* writeJson(nodePath.join(dataDir, "meta.json"), { repoBaseUrl });
  yield* writeJson(nodePath.join(dataDir, "doclinks.json"), doclinks);
  yield* writeJson(nodePath.join(dataDir, "locations.json"), {
    locations: [...locations.values()],
  });

  // --- cross-reference pass: resolve every declaration span's identifiers against the GLOBAL
  // index and invert — each page learns which documented symbols reference it. Programs are
  // rebuilt per package WITH the source `paths` (P4), so cross-package references count.
  const referencePaths: Record<string, Array<string>> = {
    "@nikscripts/effect-pm": [nodePath.join(repoRoot, "src/index.ts")],
    "@nikscripts/effect-pm/*": [nodePath.join(repoRoot, "src/*")],
  };
  for (const effectSpec of effectSpecs) {
    referencePaths[effectSpec.name] = [nodePath.join(effectSpec.srcDir, "index.ts")];
    referencePaths[`${effectSpec.name}/*`] = [nodePath.join(effectSpec.srcDir, "*")];
  }
  const allLocations = [...locations.values()];
  const referencedBy = new Map<string, Set<string>>();
  for (const [specIndex, spec] of specs.entries()) {
    const spans = spansBySpec[specIndex];
    if (spans.length === 0) continue;
    yield* Effect.gen(function* () {
      const renderer = yield* SourceRenderer.SourceRenderer;
      for (const span of spans) {
        const links = renderer.links({
          file: nodePath.join(repoRoot, span.file),
          startLine: span.startLine,
          endLine: span.endLine,
        });
        if (Option.isNone(links)) continue;
        for (const link of links.value) {
          if (link.url === span.url) continue;
          const set = referencedBy.get(link.url) ?? new Set<string>();
          set.add(span.url);
          referencedBy.set(link.url, set);
        }
      }
    }).pipe(
      Effect.provide(
        SourceRenderer.layer.pipe(
          Layer.provideMerge(LinkResolver.layer({ repoRoot })),
          Layer.provideMerge(
            Layer.mergeAll(
              TsProgram.layer({
                entries: spec.entries.map((e) => e.file),
                compilerOptions: {
                  ...spec.options,
                  baseUrl: repoRoot,
                  paths: {
                    ...spec.options.paths,
                    ...referencePaths,
                  },
                },
              }),
              SymbolIndex.layer(allLocations)
            )
          )
        )
      )
    );
    yield* Console.log(`  refs ${spec.slug.padEnd(12)} ${spans.length} spans`);
  }
  const references: Record<string, ReadonlyArray<string>> = {};
  for (const [target, referrers] of [...referencedBy.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    references[target] = [...referrers].sort();
  }
  yield* writeJson(nodePath.join(dataDir, "references.json"), { references });
  yield* Console.log(`wrote ${dataDir} — ${pkgInfos.length} package(s)`);
});

// Surface any failure — typed error or defect — as a value, then let the exit code decide. The Node
// platform services (FileSystem, Path, ChildProcessSpawner) are provided once, here at the edge.
const main = program.pipe(
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  Effect.provide(NodeServices.layer)
);
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
