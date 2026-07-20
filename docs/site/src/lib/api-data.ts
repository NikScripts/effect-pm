// Server-side access to the split API data (docs/site/api-data, produced by scripts/gen-api.ts).
// Reads go through effect/FileSystem (NEVER node:fs — docs/standards effect-style) and decode via
// Schema (no casts). Each function reads ONLY the file a page needs; run them with runServer in a
// server component. Schemas are the SSOT — the exported interfaces derive from them.

import * as nodePath from "node:path";
import { Effect, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { slugForEntry, symbolFileKey } from "./api-slugs.js";

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
const PathsS = Schema.Struct({
  symbols: Schema.Array(Schema.Tuple([Schema.String, Schema.String, Schema.String])),
});
const DocLinksS = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String));
const MetaS = Schema.Struct({ repoBaseUrl: Schema.optional(Schema.String) });
const SymbolLocationS = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  url: Schema.String,
});
const LocationsS = Schema.Struct({ locations: Schema.Array(SymbolLocationS) });
const ReferencesS = Schema.Struct({
  references: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

export interface ApiTag extends Schema.Schema.Type<typeof ApiTagS> {}
export interface ApiSource extends Schema.Schema.Type<typeof ApiSourceS> {}
export interface ApiSymbol extends Schema.Schema.Type<typeof ApiSymbolS> {}
export interface ApiSymbolRow extends Schema.Schema.Type<typeof ApiSymbolRowS> {}
export interface ModuleInfo extends Schema.Schema.Type<typeof ModuleInfoS> {}
export interface PackageInfo extends Schema.Schema.Type<typeof PackageInfoS> {}
export interface ModuleSummary extends Schema.Schema.Type<typeof ModuleSummaryS> {}
export interface SymbolLocation extends Schema.Schema.Type<typeof SymbolLocationS> {}

// Read + JSON-decode a data file through effect/FileSystem; undefined when it's missing/malformed.
const readJson = <S extends Schema.Top>(
  rel: string,
  schema: S
): Effect.Effect<S["Type"] | undefined, never, FileSystem.FileSystem | S["DecodingServices"]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(nodePath.join(dataDir, rel));
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);
  }).pipe(Effect.orElseSucceed(() => undefined));

// Re-exported (one shared copy in ./api-slugs — writer gen-api and reader here must agree).
export { slugForEntry, symbolFileKey };

export const packages = (): Effect.Effect<
  ReadonlyArray<PackageInfo>,
  never,
  FileSystem.FileSystem
> => readJson("index.json", IndexS).pipe(Effect.map((i) => i?.packages ?? []));

export const packageBySlug = (
  slug: string
): Effect.Effect<PackageInfo | undefined, never, FileSystem.FileSystem> =>
  packages().pipe(Effect.map((ps) => ps.find((p) => p.slug === slug)));

export const moduleSummary = (
  pkg: string,
  moduleSlug: string
): Effect.Effect<ModuleSummary | undefined, never, FileSystem.FileSystem> =>
  readJson(nodePath.join(pkg, `${moduleSlug}.json`), ModuleSummaryS);

export const symbolDetail = (
  pkg: string,
  moduleSlug: string,
  name: string
): Effect.Effect<ApiSymbol | undefined, never, FileSystem.FileSystem> =>
  readJson(nodePath.join(pkg, moduleSlug, `${symbolFileKey(name)}.json`), ApiSymbolS);

// Every [pkg, module, symbol] triple — the static paths for the per-symbol route.
export const symbolPaths = (): Effect.Effect<
  ReadonlyArray<readonly [string, string, string]>,
  never,
  FileSystem.FileSystem
> => readJson("paths.json", PathsS).pipe(Effect.map((p) => p?.symbols ?? []));

// Every documented declaration's location → its doc URL (deduped per line by the writer) — the
// render-time SymbolIndex for compiler source links (src/lib/api-source-links.ts).
export const symbolLocations = (): Effect.Effect<
  ReadonlyArray<SymbolLocation>,
  never,
  FileSystem.FileSystem
> => readJson("locations.json", LocationsS).pipe(Effect.map((l) => l?.locations ?? []));

// The documented symbols whose declarations REFERENCE this page (compiler-resolved inversion,
// scripts/gen-api.ts cross-reference pass) — the "Referenced by" section.
export const referencedBy = (
  url: string
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem> =>
  readJson("references.json", ReferencesS).pipe(Effect.map((r) => r?.references[url] ?? []));

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
  relFile: string
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(nodePath.join(repoRoot, relFile));
  }).pipe(Effect.orElseSucceed(() => undefined));

// Precomputed twoslash source-panel HTML for a symbol (scripts/gen-hovers.ts), for effect-smol
// packages whose source can't twoslash cheaply at render time. undefined when there's no sidecar.
export const symbolSourceHtml = (
  pkg: string,
  moduleSlug: string,
  name: string
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(
      nodePath.join(hoversDir, pkg, moduleSlug, `${symbolFileKey(name)}.src.html`)
    );
  }).pipe(Effect.orElseSucceed(() => undefined));
