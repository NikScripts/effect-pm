// Compiler-resolved source-token links for the API-reference panels — the docgen SourceRenderer
// wired into the site render. Replaces name-guessing with the IDE's resolution: every identifier in
// a rendered declaration links to the exact page its symbol is documented on (cross-package
// included), or not at all.
//
// loadSourceLinks() runs once before rendering (like loadHighlighter): it reads the model's
// location index (api-data/locations.json) and enumerates the effect-smol packages to build the
// `paths` mapping that resolves cross-package imports to the SOURCE the model was built from (the
// P4 finding — without it they resolve into node_modules and link nowhere). sourceLinksFor() is the
// sync per-span lookup the (sync) shiki pipeline calls; programs are built lazily per package and
// cached, with a rebuild when a file outside the barrel's graph is requested.

import * as nodePath from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import ts from "typescript";
import type * as Annotate from "../docgen/Annotate.js";
import * as LinkResolver from "../docgen/LinkResolver.js";
import * as SourceRenderer from "../docgen/SourceRenderer.js";
import * as SymbolIndex from "../docgen/SymbolIndex.js";
import * as TsProgram from "../docgen/TsProgram.js";
import { symbolLocations } from "./api-data.js";
import { runServer } from "./runtime.js";

const siteRoot = process.cwd(); // stable in dev and build, unlike import.meta.url (see api-data.ts)
const repoRoot = nodePath.resolve(siteRoot, "../..");
const effectPackagesDir = nodePath.join(repoRoot, "repos/effect/packages");

let locationEntries: ReadonlyArray<SymbolIndex.Entry> = [];
let pathsMap: Record<string, Array<string>> = {};
let loaded = false;

const PkgNameS = Schema.Struct({ name: Schema.optional(Schema.String) });

// name → src mappings for every effect-smol package with a src/index.ts (same enumeration as
// gen-api's), plus our own package. Meta-dirs (ai/sql/atom) expand to their child packages.
const effectPathsMap = (): Effect.Effect<
  Record<string, Array<string>>,
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const readDir = (d: string) => fs.readDirectory(d).pipe(Effect.orElseSucceed(() => []));
    const exists = (p: string) => fs.exists(p).pipe(Effect.orElseSucceed(() => false));
    const out: Record<string, Array<string>> = {
      "@nikscripts/effect-pm": [nodePath.join(repoRoot, "src/index.ts")],
      "@nikscripts/effect-pm/*": [nodePath.join(repoRoot, "src/*")],
    };
    const addPkg = (dir: string) =>
      Effect.gen(function* () {
        const text = yield* fs
          .readFileString(nodePath.join(dir, "package.json"))
          .pipe(Effect.orElseSucceed(() => "{}"));
        const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PkgNameS))(
          text
        ).pipe(Effect.orElseSucceed(() => ({ name: undefined })));
        const name = parsed.name;
        if (name === undefined) return;
        out[name] = [nodePath.join(dir, "src/index.ts")];
        out[`${name}/*`] = [nodePath.join(dir, "src/*")];
      });
    for (const entry of yield* readDir(effectPackagesDir)) {
      if (entry === "tools") continue;
      const dir = nodePath.join(effectPackagesDir, entry);
      if (yield* exists(nodePath.join(dir, "src/index.ts"))) {
        yield* addPkg(dir);
        continue;
      }
      for (const sub of yield* readDir(dir)) {
        const subDir = nodePath.join(dir, sub);
        if (yield* exists(nodePath.join(subDir, "src/index.ts"))) yield* addPkg(subDir);
      }
    }
    return out;
  });

/** Load the location index + package path map (idempotent). Await before rendering. */
export const loadSourceLinks = async (): Promise<void> => {
  if (loaded) return;
  locationEntries = await runServer(symbolLocations());
  pathsMap = await runServer(effectPathsMap());
  loaded = true;
};

/** The loaded location entries ([] before {@link loadSourceLinks}) — the shared SymbolIndex feed. */
export const symbolIndexEntries = (): ReadonlyArray<SymbolIndex.Entry> => locationEntries;

// The package a repo-relative source file belongs to (its dir, repo-relative; "." = effect-pm).
// Undefined for files outside the documented trees — no links rather than a wrong program.
const packageDirOf = (relFile: string): string | undefined => {
  const effect = /^(repos\/effect\/packages\/[^/]+(?:\/[^/]+)?)\/src\//.exec(relFile);
  if (effect !== null) return effect[1];
  if (relFile.startsWith("src/")) return ".";
  return undefined;
};

interface Stack {
  readonly roots: ReadonlySet<string>;
  readonly renderer: SourceRenderer.SourceRenderer;
  readonly hasFile: (abs: string) => boolean;
}
const stacks = new Map<string, Stack>();

// Building a program is seconds-heavy; done at most once per package (plus a rebuild when a file
// outside the barrel's import graph — e.g. a node-only subpath — shows up, keeping prior roots).
const buildStack = (pkgDir: string, roots: ReadonlySet<string>): Stack => {
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    allowImportingTsExtensions: true, // effect-smol source imports with explicit `.ts`
    noEmit: true,
    baseUrl: repoRoot,
    paths: pathsMap,
  };
  return Effect.runSync(
    Effect.gen(function* () {
      const renderer = yield* SourceRenderer.SourceRenderer;
      const program = yield* TsProgram.TsProgram;
      return {
        roots,
        renderer,
        hasFile: (abs: string) => Option.isSome(program.sourceFile(abs)),
      };
    }).pipe(
      Effect.provide(
        SourceRenderer.layer.pipe(
          Layer.provideMerge(LinkResolver.layer({ repoRoot })),
          Layer.provideMerge(
            Layer.mergeAll(
              TsProgram.layer({ entries: [...roots], compilerOptions }),
              SymbolIndex.layer(locationEntries)
            )
          )
        )
      )
    )
  );
};

/**
 * Compiler-resolved links for the identifiers in a source span (1-based inclusive lines of a
 * repo-relative file), offsets relative to the span start. undefined before loadSourceLinks(), for
 * files outside the documented packages, and for spans the program can't see.
 */
export const sourceLinksFor = (
  relFile: string,
  startLine: number,
  endLine: number
): ReadonlyArray<Annotate.Link> | undefined => {
  if (!loaded) return undefined;
  const pkgDir = packageDirOf(relFile);
  if (pkgDir === undefined) return undefined;
  const abs = nodePath.join(repoRoot, relFile);
  const cached = stacks.get(pkgDir);
  const stack =
    cached !== undefined && cached.hasFile(abs)
      ? cached
      : buildStack(
          pkgDir,
          new Set([
            nodePath.join(repoRoot, pkgDir === "." ? "" : pkgDir, "src/index.ts"),
            ...(cached?.roots ?? []),
            abs,
          ])
        );
  if (stack !== cached) stacks.set(pkgDir, stack);
  return Option.getOrUndefined(
    stack.renderer.links({
      file: abs,
      startLine,
      endLine,
    })
  );
};
