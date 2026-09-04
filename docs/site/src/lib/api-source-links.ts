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
import * as Annotate from "@nikscripts/docgen/Annotate";
import * as HoverRenderer from "@nikscripts/docgen/HoverRenderer";
import * as LinkResolver from "@nikscripts/docgen/LinkResolver";
import * as SourceRenderer from "@nikscripts/docgen/SourceRenderer";
import * as SymbolIndex from "@nikscripts/docgen/SymbolIndex";
import * as TsProgram from "@nikscripts/docgen/TsProgram";
import * as TypePrinter from "@nikscripts/docgen/TypePrinter";
import { symbolLocations } from "./api-data.js";
import { processSlot } from "./processSlot.js";
import { runServer } from "./runtime.js";

const siteRoot = process.cwd(); // stable in dev and build, unlike import.meta.url (see api-data.ts)
const repoRoot = nodePath.resolve(siteRoot, "../..");
const effectPackagesDir = nodePath.join(repoRoot, "repos/effect/packages");

type SourceLinksSlot = {
  locationEntries: ReadonlyArray<SymbolIndex.Entry>;
  pathsMap: Record<string, Array<string>>;
  loaded: boolean;
  loadPromise: Promise<void> | undefined;
};
const slot = (): SourceLinksSlot =>
  processSlot("sourceLinks", () => ({
    locationEntries: [],
    pathsMap: {},
    loaded: false,
    loadPromise: undefined,
  }));

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
      "hyperlink-ts": [nodePath.join(repoRoot, "src/index.ts")],
      "hyperlink-ts/*": [nodePath.join(repoRoot, "src/*")],
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
  const s = slot();
  if (s.loaded) return;
  s.loadPromise ??= (async () => {
    s.locationEntries = await runServer(symbolLocations());
    s.pathsMap = await runServer(effectPathsMap());
    s.loaded = true;
  })();
  await s.loadPromise;
};

/** The loaded location entries ([] before {@link loadSourceLinks}) — the shared SymbolIndex feed. */
export const symbolIndexEntries = (): ReadonlyArray<SymbolIndex.Entry> => slot().locationEntries;

/**
 * The loaded package→source `paths` map (empty before {@link loadSourceLinks}) — resolves
 * `effect`/`@effect/*` imports to the SOURCE the model documents (P4). The hover expander merges
 * this in so GUIDE example hovers resolve to documented declarations; version skew between the
 * runtime dep and the repos source is guarded downstream by realign (mismatch = no link).
 */
export const packageSourcePaths = (): Readonly<Record<string, Array<string>>> => slot().pathsMap;

// The package a repo-relative source file belongs to (its dir, repo-relative; "." = hyperlink-ts).
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
  readonly hover: HoverRenderer.HoverRenderer;
  readonly resolver: LinkResolver.LinkResolver;
  readonly program: TsProgram.TsProgram;
  readonly hasFile: (abs: string) => boolean;
}
const stacks = new Map<string, Stack>();

// Building a program is seconds-heavy; done at most once per package (plus a rebuild when a file
// outside the barrel's import graph — e.g. a node-only subpath — shows up, keeping prior roots).
const buildStack = (pkgDir: string, roots: ReadonlySet<string>): Stack => {
  const s = slot();
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
    paths: s.pathsMap,
  };
  return Effect.runSync(
    Effect.gen(function* () {
      const renderer = yield* SourceRenderer.SourceRenderer;
      const hover = yield* HoverRenderer.HoverRenderer;
      const resolver = yield* LinkResolver.LinkResolver;
      const program = yield* TsProgram.TsProgram;
      return {
        roots,
        renderer,
        hover,
        resolver,
        program,
        hasFile: (abs: string) => Option.isSome(program.sourceFile(abs)),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(SourceRenderer.layer, HoverRenderer.layer).pipe(
          Layer.provideMerge(TypePrinter.layer),
          Layer.provideMerge(LinkResolver.layer({ repoRoot })),
          Layer.provideMerge(
            Layer.mergeAll(
              TsProgram.layer({ entries: [...roots], compilerOptions }),
              SymbolIndex.layer(s.locationEntries)
            )
          )
        )
      )
    )
  );
};

// The package stack for a repo-relative file (built/extended lazily); undefined outside the
// documented trees or before load.
const stackFor = (relFile: string): Stack | undefined => {
  if (!slot().loaded) return undefined;
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
  return stack.hasFile(abs) ? stack : undefined;
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
  const stack = stackFor(relFile);
  if (stack === undefined) return undefined;
  return Option.getOrUndefined(
    stack.renderer.links({
      file: nodePath.join(repoRoot, relFile),
      startLine,
      endLine,
    })
  );
};

// --- declaration-level links for the symbol pages' signature / type blocks ---

// The exported declaration STATEMENT starting at `line` (1-based), searching namespace blocks too
// (matches the extractor's declNode line rule).
const declarationAt = (sf: ts.SourceFile, line: number): ts.Node | undefined => {
  let found: ts.Node | undefined;
  const isCandidate = (node: ts.Node): boolean =>
    ts.isVariableStatement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node);
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      isCandidate(node) &&
      sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 === line
    ) {
      found = node;
      return;
    }
    if (ts.isSourceFile(node) || ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) {
      node.forEachChild(visit);
    }
  };
  visit(sf);
  return found;
};

const declarationName = (node: ts.Node): ts.Node | undefined => {
  if (ts.isVariableStatement(node)) {
    const name = node.declarationList.declarations[0]?.name;
    return name !== undefined && ts.isIdentifier(name) ? name : undefined;
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name;
  }
  return undefined;
};

// A call signature's SOURCE slice — from its start to the body / `=>` — plus the resolved links of
// the identifiers inside it, offsets slice-relative.
const signatureSlice = (
  resolver: LinkResolver.LinkResolver,
  sf: ts.SourceFile,
  decl: ts.SignatureDeclaration
): { readonly text: string; readonly links: ReadonlyArray<Annotate.Link> } => {
  const start = decl.getStart(sf);
  const end = ts.isArrowFunction(decl)
    ? decl.equalsGreaterThanToken.getStart(sf)
    : ts.isFunctionDeclaration(decl) ||
      ts.isFunctionExpression(decl) ||
      ts.isMethodDeclaration(decl)
    ? decl.body?.getStart(sf) ?? decl.getEnd()
    : decl.getEnd();
  const links: Array<Annotate.Link> = [];
  const visit = (node: ts.Node): void => {
    if (node.getStart(sf) >= end || node.getEnd() <= start) return;
    if (ts.isIdentifier(node)) {
      const at = node.getStart(sf);
      if (at < start || node.getEnd() > end) return;
      Option.match(resolver.resolve(node), {
        onNone: () => {},
        onSome: (url) =>
          links.push({
            start: at - start,
            end: node.getEnd() - start,
            url,
          }),
      });
      return;
    }
    node.forEachChild(visit);
  };
  visit(decl);
  return {
    text: sf.text.slice(start, end).trimEnd(),
    links,
  };
};

/**
 * Links for a symbol page's rendered signature/type strings: one link list per displayed string,
 * REALIGNED onto it (prettier formatting survives; a genuine text mismatch yields no links — never
 * a guess). Call signatures realign each declaration's source slice onto its displayed string;
 * everything else realigns the symbol's HoverRenderer parts onto `displayed[0]`. undefined when
 * the declaration can't be found.
 */
export const declarationTypeLinks = (
  relFile: string,
  line: number,
  displayed: ReadonlyArray<string>
): ReadonlyArray<ReadonlyArray<Annotate.Link>> | undefined => {
  const stack = stackFor(relFile);
  if (stack === undefined) return undefined;
  const abs = nodePath.join(repoRoot, relFile);
  const sf = Option.getOrUndefined(stack.program.sourceFile(abs));
  if (sf === undefined) return undefined;
  const decl = declarationAt(sf, line);
  const name = decl === undefined ? undefined : declarationName(decl);
  if (decl === undefined || name === undefined) return undefined;
  const checker = stack.program.checker;
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol === undefined) return undefined;

  const typeish =
    (symbol.flags &
      (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) !==
    0;
  const signatures = typeish
    ? []
    : checker.getTypeOfSymbolAtLocation(symbol, decl).getCallSignatures();
  if (signatures.length > 0 && signatures.length === displayed.length) {
    return displayed.map((text, i) => {
      const sigDecl = signatures[i].getDeclaration();
      const slice = signatureSlice(stack.resolver, sf, sigDecl);
      return Option.getOrElse(Annotate.realign(slice.links, slice.text, text), () => []);
    });
  }
  const hover = Option.getOrUndefined(stack.hover.hover(symbol));
  if (hover === undefined || displayed.length === 0) return undefined;
  return displayed.map((text, i) =>
    i === 0 ? Option.getOrElse(Annotate.realign(hover.links, hover.text, text), () => []) : []
  );
};
