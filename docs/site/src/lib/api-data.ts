// Server-side access to the split API data (docs/site/api-data, produced by scripts/gen-api.ts).
// Reads go through effect/FileSystem (NEVER node:fs — docs/standards effect-style) and decode via
// Schema (no casts). Each function reads ONLY the file a page needs; run them with runServer in a
// server component. Schemas are the SSOT — the exported interfaces derive from them.

import * as nodePath from "node:path";
import { Effect, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

// Resolve the data dirs from the working directory (docs/site in both `waku dev` and `waku build`),
// NOT import.meta.url: in a production build the bundled module's URL points into dist/, so a
// URL-relative path misses api-data/api-hovers entirely and every api page renders empty. cwd is
// stable and correct in both modes.
const siteRoot = process.cwd();
const dataDir = nodePath.join(siteRoot, "api-data");
const hoversDir = nodePath.join(siteRoot, "api-hovers"); // gen-hovers sidecars
const repoRoot = nodePath.resolve(siteRoot, "../.."); // docs/site -> repo root

const ApiTagS = Schema.Struct({ name: Schema.String, text: Schema.String });
const ApiSourceS = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  url: Schema.optional(Schema.String),
});
const ApiSymbolS = Schema.Struct({
  entry: Schema.String,
  name: Schema.String,
  qualifiedName: Schema.String,
  url: Schema.String,
  kind: Schema.String,
  signatures: Schema.Array(Schema.String),
  typeText: Schema.optional(Schema.String),
  sourceText: Schema.String,
  summary: Schema.String,
  rawComment: Schema.String,
  tags: Schema.Array(ApiTagS),
  category: Schema.optional(Schema.String),
  linkTargets: Schema.Array(Schema.String),
  docLinks: Schema.Record(Schema.String, Schema.String),
  source: ApiSourceS,
});
const ApiSymbolRowS = Schema.Struct({
  name: Schema.String,
  qualifiedName: Schema.String,
  kind: Schema.String,
  summary: Schema.String,
  url: Schema.String,
});
const ModuleInfoS = Schema.Struct({
  slug: Schema.String,
  entry: Schema.String,
  count: Schema.Number,
});
const PackageInfoS = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  modules: Schema.Array(ModuleInfoS),
});
const IndexS = Schema.Struct({ packages: Schema.Array(PackageInfoS) });
const ModuleSummaryS = Schema.Struct({
  package: Schema.String,
  entry: Schema.String,
  symbols: Schema.Array(ApiSymbolRowS),
});
const LinkSymbolS = Schema.Struct({
  name: Schema.String,
  qualifiedName: Schema.String,
  url: Schema.String,
});
const LinksS = Schema.Struct({ symbols: Schema.Array(LinkSymbolS) });
const PathsS = Schema.Struct({
  symbols: Schema.Array(Schema.Tuple([Schema.String, Schema.String, Schema.String])),
});
const DocLinksS = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String));
const MetaS = Schema.Struct({ repoBaseUrl: Schema.optional(Schema.String) });

export interface ApiTag extends Schema.Schema.Type<typeof ApiTagS> {}
export interface ApiSource extends Schema.Schema.Type<typeof ApiSourceS> {}
export interface ApiSymbol extends Schema.Schema.Type<typeof ApiSymbolS> {}
export interface ApiSymbolRow extends Schema.Schema.Type<typeof ApiSymbolRowS> {}
export interface ModuleInfo extends Schema.Schema.Type<typeof ModuleInfoS> {}
export interface PackageInfo extends Schema.Schema.Type<typeof PackageInfoS> {}
export interface ModuleSummary extends Schema.Schema.Type<typeof ModuleSummaryS> {}
export interface LinkSymbol extends Schema.Schema.Type<typeof LinkSymbolS> {}

// Read + JSON-decode a data file through effect/FileSystem; undefined when it's missing/malformed.
const readJson = <S extends Schema.Top>(
  rel: string,
  schema: S,
): Effect.Effect<S["Type"] | undefined, never, FileSystem.FileSystem | S["DecodingServices"]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(nodePath.join(dataDir, rel));
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));

// A namespace entry -> its URL slug. Mirrors scripts/gen-api.ts (kept in sync).
export const slugForEntry = (entry: string): string =>
  entry === "(top-level)" ? "top-level" : entry.replace(/\//g, "-");

// An export name -> its on-disk data-file key. Export names can differ only by case (a type `Foo` and
// a value `foo` in one module); on a case-insensitive filesystem `Foo.json` and `foo.json` are the
// SAME file, so one clobbers the other. Encode a case-insensitively-unique key: lowercase the name and
// append the uppercase-letter positions (joined by `-`, which no identifier contains). Pure-lowercase
// names are unchanged. The URL keeps the real name; only the file uses this key. Mirrors
// scripts/gen-api.ts (kept in sync).
export const symbolFileKey = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower === name) return name;
  const upper = [...name].flatMap((c, i) => (c !== c.toLowerCase() ? [i] : []));
  return `${lower}-${upper.join("-")}`;
};

export const packages = (): Effect.Effect<
  ReadonlyArray<PackageInfo>,
  never,
  FileSystem.FileSystem
> => readJson("index.json", IndexS).pipe(Effect.map((i) => i?.packages ?? []));

export const packageBySlug = (
  slug: string,
): Effect.Effect<PackageInfo | undefined, never, FileSystem.FileSystem> =>
  packages().pipe(Effect.map((ps) => ps.find((p) => p.slug === slug)));

export const moduleSummary = (
  pkg: string,
  moduleSlug: string,
): Effect.Effect<ModuleSummary | undefined, never, FileSystem.FileSystem> =>
  readJson(nodePath.join(pkg, `${moduleSlug}.json`), ModuleSummaryS);

export const symbolDetail = (
  pkg: string,
  moduleSlug: string,
  name: string,
): Effect.Effect<ApiSymbol | undefined, never, FileSystem.FileSystem> =>
  readJson(nodePath.join(pkg, moduleSlug, `${symbolFileKey(name)}.json`), ApiSymbolS);

// Every [pkg, module, symbol] triple — the static paths for the per-symbol route.
export const symbolPaths = (): Effect.Effect<
  ReadonlyArray<readonly [string, string, string]>,
  never,
  FileSystem.FileSystem
> => readJson("paths.json", PathsS).pipe(Effect.map((p) => p?.symbols ?? []));

// The build-only global index used to resolve doc links (name/qualifiedName -> url).
export const linkSymbols = (): Effect.Effect<
  ReadonlyArray<LinkSymbol>,
  never,
  FileSystem.FileSystem
> => readJson("links.json", LinksS).pipe(Effect.map((l) => l?.symbols ?? []));

// Resolved {@link} maps keyed by a symbol's declaration `file:line` — for hover link resolution.
export const docLinksByLocation = (): Effect.Effect<
  Readonly<Record<string, Record<string, string>>>,
  never,
  FileSystem.FileSystem
> => readJson("doclinks.json", DocLinksS).pipe(Effect.map((d) => d ?? {}));

export const repoBaseUrl = (): Effect.Effect<string, never, FileSystem.FileSystem> =>
  readJson("meta.json", MetaS).pipe(Effect.map((m) => m?.repoBaseUrl ?? ""));

// The full text of a symbol's source file (repo-relative), for the twoslash source panel. Read
// through effect/FileSystem so the sync render pipeline never touches node:fs; undefined if missing.
export const readSourceFile = (
  relFile: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(nodePath.join(repoRoot, relFile));
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));

// Precomputed twoslash source-panel HTML for a symbol (scripts/gen-hovers.ts), for effect-smol
// packages whose source can't twoslash cheaply at render time. undefined when there's no sidecar.
export const symbolSourceHtml = (
  pkg: string,
  moduleSlug: string,
  name: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(
      nodePath.join(hoversDir, pkg, moduleSlug, `${symbolFileKey(name)}.src.html`),
    );
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));
